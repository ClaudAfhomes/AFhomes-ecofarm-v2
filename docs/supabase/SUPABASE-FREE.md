# AF Homes: Supabase Free capacity and implementation SSOT

Updated: 2026-10-13 (Asia/Singapore). Status: current repository practices and a read-only capacity snapshot; proposed policies are explicitly marked. This file is the single reference for working within the Supabase Free budget. Repository code, migrations and `AGENTS.md` remain authoritative for application behavior. Update this document when a quota, query, storage rule or company decision changes; do not create parallel capacity documents. Implementation work derived from this document lives in `docs/supabase/solutions/EGRESS-SOLUTIONS.md` (Phase 1 — egress and bandwidth reduction), `docs/supabase/solutions/DATABASE-SOLUTIONS.md` (Phase 2 — database size control), `docs/supabase/solutions/MAU-SOLUTIONS.md` (Phase 3 — Monthly Active Users control), `docs/supabase/solutions/STORAGE-SOLUTIONS.md` (Phase 4 — File Storage control + public URL media), `docs/supabase/solutions/LOG-SOLUTIONS.md` (Phase 5 — Log Ingestion control) and `docs/supabase/solutions/LOG-QUERY-SOLUTIONS.md` (Phase 6 — Log Query control).

## Current database and application

- Numbering policy reference: [AF Homes business rules](../AFHOMES-BUSINESS-RULES.md). It preserves the supplied ID-generation draft and distinguishes proposed formats from the current generators; it authorizes no numbering or database change.
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

## Public AA verification

Migration `20261130000001_afhomes_sale_team_accreditation.sql` was applied to `ikaevepedpqygdlipsei` on 2026-10-14 after explicit approval. Executed SHA-256: `6c85fd2e0018b1f267a396397f8dfd4a0530a1977f6bc5630020e7bccf57b844`. Verification passed for the five function definitions/ACLs, private-table RLS/grants, approval trigger, optional MFA singleton/getter and six RLS invariants. History contains 72 applied versions; the new AA table contained zero rows after execution. Protected account, VIP plan, sales, payment, membership, points and audit row counts were unchanged. No test accounts or accreditation records were created. Managed PostgREST service-role lookup returned HTTP 200/null; anonymous direct RPC and private-schema reads were denied. Application deployment must follow this migration.

`/sale-team-search` submits an exact AA lookup through `/sale-team/search`; no directory, substring search, autocomplete or polling. One unique AA index narrows the database lookup, and one service-only RPC returns only the approved public name, IST/OST classification, AA number, current status and validity dates. Public searches return only currently accredited records. Responses use `Cache-Control: no-store` so new lookups observe revocation; searches do not append business audit rows or store per-search counters in Postgres.

AA records and the generator stay private with RLS and no browser grants. Issuance generates 12 cryptographically random characters containing exactly six uppercase letters and six digits (after the AA- prefix), protected by a unique constraint and bounded collision retries, with approval/revocation audit events. AA numbers survive renewal. Self-service name edits do not change the approved public name. Existing accounts receive no automatic AA backfill. IST approval covers only VD/SSM/SM, by Admin/Super Admin with effective `organization.staff:update`; OST AA issuance requires effective `network.ost_registrations:update` and approved OST terms. New approved OST accounts receive their AA during invitation, but public verification remains blocked until account activation. Number generation is centralized for the future company format.

Release order: separately approve and apply only `20261130000001_afhomes_sale_team_accreditation.sql` after verifying the existing OST workflow and `20261129000002_afhomes_staff_business_security.sql`, then deploy the dependent API and apps. This feature does not authorize other pending migrations. Rollback disables the feature/API, retaining issued identifiers and audit history; never renumber issued AA records or weaken grants. Repeatable local proof: `node packages/db-testing/scripts/test-sale-team.mjs` boots disposable PostgreSQL and checks issuance, concurrency, ownership boundaries, renewal, expiry/revocation and browser ACL denial.

Residual public risk: random AA numbers are public identifiers, not authentication credentials. The existing 30-search/minute IP limiter is per server instance, resets on cold starts and is not a distributed quota control. Verify platform edge throttling separately before broad public rollout; do not claim the in-process limiter prevents distributed scraping. Managed Auth/PostgREST acceptance and deployed latency remain unverified until a separately authorized release.

## Database normalization checkpoint (2026-10-14)

**Status: approved archival/integrity checkpoint APPLIED AND VERIFIED on 2026-10-14; committed as `d820975`. Profile photos are implemented locally in `b36d216`; their bucket migration is applied and verified as recorded below.** The initial audit used explicitly read-only transactions and 15-20 second statement limits. After separate user approval, only the two exact migrations documented below were applied to `ikaevepedpqygdlipsei`, in order. The two orphan operational rule rows moved into an immutable private archive with retained full snapshots and two new audit events. Protected records/prior audit history remained unchanged; no Auth setting or Storage object was changed. This review covers relational integrity and input formatting; it does not certify every table as strict third normal form or promise faster queries from schema decomposition.

### Live evidence and coverage

Project `ikaevepedpqygdlipsei`, PostgreSQL 17.6: 69 application tables in `public`/`private`, 971 columns, 716 validated constraints, 201 foreign keys and 167 valid unique indexes (including primary-key indexes). Every application table has a primary key. All 201 declared foreign-key relationships were checked for orphan rows: **zero**. These checks deliberately returned counts and schema metadata, not customer identities or financial payloads. Platform-owned `auth` and `storage` schemas were not redesigned.

The whole application-table inventory was reviewed by responsibility:

| Area | Tables reviewed | Normalization decision |
| --- | --- | --- |
| Access and staff | `departments`, `roles`, `modules`, `role_permissions`, `staff_users`, `staff_role_assignments`, `staff_permission_restrictions`, `staff_invitations`, `private.staff_security_policy` | Keep keyed role/module relations and the singleton policy. A staff profile is linked to Auth by its existing primary-key FK. Invitations are lifecycle evidence, not duplicate current staff profiles. |
| Customer and onboarding | `customers`, `customer_onboarding_tokens`, `identity_documents`, `customer_import_jobs`, `customer_import_rows` | Keep customer ownership, separate documents and import staging. Never deduplicate customers by name or email alone. Raw import/OCR data is evidence; it must not replace reviewed master values automatically. |
| Applications and purchase terms | `customer_applications`, `customer_application_holders`, `customer_application_documents`, `customer_application_purchase_terms` | Holders/documents already have child relations; versioned purchase terms and submitted form values retain their recorded identity and economics. |
| OST, genealogy and AA | `ost_applications`, `ost_members`, `referral_codes`, `referral_relationships`, `private.ost_registration_details`, `private.ost_accreditation_renewals`, `private.ost_accreditation_terms`, `private.ost_import_jobs`, `private.ost_import_rows`, `private.sale_team_accreditations` | Keep invitation/account/application/term lifecycles separate. Referral and approved-name snapshots retain their historical meaning. Request UUIDs are idempotency identifiers, not missing entity FKs. |
| VIP sales and commissions | `card_categories`, `card_plans`, `card_sales`, `card_sale_hierarchy_snapshots`, `payments`, `final_qualifications`, `memberships`, `commissions`, `commission_rules` | Keep immutable sale-time economics and ancestry. Harden the unconstrained polymorphic commission-rule target without changing the API's target vocabulary. |
| Reservations and documents | `reservation_agreements`, `reservation_agreement_holders`, `reservation_agreement_schedule`, `reservation_agreement_documents`, `private.purchase_document_evidence` | Holder/schedule/document rows are already separated. Preserve executed forms and document revisions; their snapshot data cannot be reconstructed from today's catalog. |
| Services and points | `tier_points_config`, `points_accounts`, `points_ledger`, `points_periods`, `service_catalog`, `point_earning_rules`, `point_redemption_rules`, `purchases`, `purchase_lines`, `purchase_payments`, `redemption_quotes`, `earning_claims`, `service_tier_discounts`, `purchase_point_refunds`, `service_refunds`, `service_refund_repayments`, `redemption_items`, `redemptions` | Preserve the one-account/ledger model, transaction lines, exact amounts, snapshots and locks. Bounded tier/channel arrays and service-photo metadata are not claimed to be strict relational 1NF; decomposition needs a demonstrated independent lifecycle/query requirement and a compatibility plan. |
| CMS and operational evidence | `cms_documents`, `cms_document_versions`, `cms_pages`, `cms_page_sections`, `cms_page_versions`, `cms_media_assets`, `audit_events`, `private.business_id_aliases`, `private.mutation_requests` | Keep published/versioned JSON documents and append-only audit evidence. Polymorphic aliases/document references are reviewed explicitly rather than misclassified as ordinary absent FKs. |

Seven consistency probes passed: membership cached balance versus points account, membership customer versus sale, payment customer versus sale, purchase customer versus membership, earning-claim owner/account/period relationships, document source versus its typed source FK, and duplicate service-photo paths. These are current-data checks, not new constraints on every redundant column. Most business tables are empty: name/email probes found only the one existing staff profile populated, with no canonicalization discrepancy; all six phone/contact columns inspected were empty. This is **not representative populated-business-data proof**.

Canonical-email collision probes for staff and OST, repeated rule tiers/application channels, and address JSON object checks returned zero violations. All six existing live RLS invariants returned zero rows. `private.business_id_aliases` does not have RLS enabled, but direct anonymous/authenticated read/write ACLs are denied; this inspection did not change that historical object.

### Confirmed integrity defect and local correction

`commission_rules.target_id` is polymorphic and has no declared target FK. The creation handler checks existence, but that check cannot protect against later/concurrent deletion. Local regression tests reproduced both ordinary staff deletion and test-account purge leaving a rule behind. The handler now blocks staff/OST target deletion and preserves rule creator/updater attribution. Target types remain distinct: a role-target UUID is not treated as a staff target merely because its UUID matches.

The live audit found exactly two dangling **staff-target** rules:

| Rule ID | State | Recorded effective window | Sale / commission / purchase-term / reservation references |
| --- | --- | --- | --- |
| `01d28c04-b31c-48e5-be11-b1ec7db35cd5` | Inactive | 2026-10-01 onward | 0 / 0 / 0 / 0 |
| `9a7640d8-4b93-44ed-aa47-f93ecbce2db1` | Active flag | 2026-10-01 through 2026-10-01 | 0 / 0 / 0 / 0 |

No target owner was guessed or reassigned. On 2026-10-14 the user first requested preparation/local testing, then separately approved applying only the archival repair followed by the integrity safeguards. The two source rows are now archived with their original values and evidence intact. No generic deduplication, additional cleanup or arbitrary reassignment was performed.

Approved and applied exact archival migration: `20261130000002_afhomes_archive_orphan_commission_rules.sql`, raw SHA-256 `01b88a1d153cb733283071d0bbe063acc044b1b3c411fc50edc87be0f35bd605`. Only the two IDs above are allowlisted. Complete original row hashes were rechecked before execution and matched the preserved archive/audit before-images afterward:

| Rule ID | Original full-row SHA-256 |
| --- | --- |
| `01d28c04-b31c-48e5-be11-b1ec7db35cd5` | `23c969c31b18b7d959cf784dc215c970840c0a26fa595a58ddd1fb55dfe6a6e8` |
| `9a7640d8-4b93-44ed-aa47-f93ecbce2db1` | `1d445cf3fcacb87ee3bc30377c46618f5a75acd793f520449419c1b88c622e5b` |

The migration locks operational rule writes and each source row, rejects an unreviewed orphan, changed/missing row, restored staff target, eligible active rule, conflicting archive, or financial dependency, then copies the **entire original row** and checksum into `private.commission_rule_archive`. It appends one `COMMISSION_RULE_ARCHIVED` audit event containing the original before-image, archive reference and migration request ID, and only then removes that allowlisted rule from the operational table. Historical audit events remain intact. All four live foreign-key dependencies on commission rules were enumerated and match the explicit checks: `card_sales`, `commissions`, `customer_application_purchase_terms`, `reservation_agreements`. Foreign keys also protect against concurrent reference creation while source rows are locked.

Archive access is operator-only: RLS enabled, direct ACLs revoked from PUBLIC/anon/authenticated/service_role, and a non-callable private trigger rejects UPDATE, DELETE and TRUNCATE, including by the ordinary database-owner path. The original staff target UUID is retained as historical evidence, not reassigned or converted into a fake live account. No generic cleanup RPC or new public archive endpoint is added. Existing authorized commission-rule history reads audit events by ID without requiring an operational rule row, so retained history can still be read through that established API. No new index or extension is required.

Both row removal and its archive/audit writes commit together. A failure on the second row rolls back the first row's archival and audit insert. Replay verifies preserved archive hashes and exactly one expected audit event per ID and appends nothing. A fresh empty rebuild initializes the archive but archives no rows; **shared execution must separately verify exactly the two approved source rows and their hashes**, never use the empty-rebuild branch as a substitute for shared preflight. Verified live result: operational rule count 3 -> 1, archive 0 -> 2, exactly two new audit events, no protected account/VIP/sale/payment/commission/terms/reservation/membership/points/AA changes. The remaining valid rule retains its complete values.

Local proof uses synthetic identities, prices and rules only. The raw archival migration executes on the fresh empty local schema; exercising the two-row repair substitutes only the two expected SHA pins for the synthetic rows' hashes, leaving IDs and all repair logic unchanged. This is branch/transaction proof, not execution of genuine live rows locally. Tests cover changed-second-row rollback, an unexpected orphan, a real sale dependency, full snapshot/hash preservation, byte-for-value comparisons of protected rows and prior audit events, remaining-rule/current-rate preservation, direct ACL denial, immutable archive mutation denials and duplicate-free replay. All fixtures and the disposable PostgreSQL server are removed before reporting PASS. No live disposable accounts or financial records were created.

Approved and applied integrity migration: `20261201000001_afhomes_normalization_integrity.sql`, raw SHA-256 `53634935740fdb57be42c83d6b39938efca3052c06164c0f30f9dcf1d47b431e`. The CLI-created migration was ordered after the repository's existing future-versioned AA migration and archival repair. It:

1. Stops with `NORMALIZATION_BLOCKED_ORPHAN_COMMISSION_TARGETS` before DDL when any target is missing.
2. Derives read-only role/staff/OST target keys from the existing discriminator and `target_id`, then adds three validated real FKs with restrictive deletion. Callers still submit the existing fields; generated keys cannot be supplied or drift independently.
3. Adds validated canonical-email checks to `staff_users`, `customers` and `ost_members`, matching the established API lowercase/trim policy. It performs no data backfill or account/Auth change.

No new indexes, extensions or infrastructure are introduced. The generated target keys add bounded per-rule storage and FK write checks; no representative performance gain or overhead benchmark is claimed. Existing API presentation explicitly maps the original rule fields, preserving response compatibility. Existing browser ACLs/RLS are not widened.

### Formatting authority

Current code, including the latest `develop` changes, is authoritative over stale uppercase-name comments. Reuse `packages/contracts/src/schemas/input.ts` and the existing handler/import normalization paths:

- Person names: trim/collapse whitespace, validate supported Unicode name characters and **preserve deliberate capitalization** (`McDonald`, `de la Cruz`). Do not uppercase all names or rewrite approved AA names.
- Emails: trim and lowercase on input. Proposed database checks enforce storage form; they do not synchronize Auth emails or turn customer email into a unique person identifier.
- Phones: reject letters; canonicalize supported Philippine mobile forms; preserve valid international/landline distinctions under the existing shared schemas. Do not invent missing country codes.
- Addresses: uppercase user-entered street/business prose where the established schema requires it; preserve official geographic spelling/case and validate PSGC hierarchy server-side. Existing geographic code/name fields are a provider-validated representation, not permission evidence. No live address was silently re-resolved.
- Money/points/dates: retain exact-decimal money, integer points, valid calendar dates and existing lifecycle rules. Numerically equal money strings in frozen records are not grounds for rewriting history.
- Never case-fold passwords, tokens, URLs, hashes, keys, storage paths, notes, raw import records or document/audit snapshots.

No current master value required a formatting rewrite in this read-only snapshot. New write paths must use the shared contracts; no second naming/phone policy or generic all-column normalization trigger is added.

### Release and approval boundary

Before execution live history contained 72 versions; after the verified two-file batch it contains **74**, latest `20261201000001`. The pre-change checkout had 74 migration files and now contains 76. Three local versions remain absent from recorded history: `20261030000001`, `20261031000001`, `20261127000001`. The catalog-policy name is instead recorded under remote-only version `20261012075439`. A matching name is **not** proof of an identical applied body. These version differences do not authorize applying unrelated files; do not use the broad migration runner. The archive now contains two rows and there are two repair audit events. Optional administrative MFA remains false.

Executed approved order: (1) revalidated target `ikaevepedpqygdlipsei`, verified-TLS connection, 72-version history, all four dependent FK definitions, zero new references, canonical-email compatibility, both rule snapshots and both full-file hashes; (2) applied **only** `20261130000002_afhomes_archive_orphan_commission_rules.sql`, verified exactly two snapshots/audits and protected state before and after commit; (3) applied **only** `20261201000001_afhomes_normalization_integrity.sql`, verified all six validated constraints and generated-key definitions, restrictive FK targets, zero target orphans, remaining original rule values and six RLS invariants before and after commit. Exact versions/full SQL bodies were recorded only after successful in-transaction verification, atomically with each migration. An independent connector read confirmed the committed 74-version history and both recorded SQL SHA-256 hashes. No historical/pending directory/catalog migrations, indexes or Auth settings were included. Local API deletion guards are committed in d820975 and remain undeployed; they can ship independently, while SQL FKs already protect direct/concurrent writes. No Git push or Vercel deployment was performed for this checkpoint.

Each migration is transactional and stops on invalid existing data. A failed apply must roll back that migration and report actual state. If archival commits but integrity fails, retain the preserved archive and the valid remaining operational rule; stop before further changes. After successful application, fix incompatible callers forward rather than disabling FKs or canonical-email checks. Do not restore the dangling rules automatically: a later approved restore must verify a real intended owner and valid policy dates, use the retained snapshots as evidence, and append an audit event. Super Admin, VIP plans, issued AA numbers, documented prices, verified payments, balances and prior audit history were preserved. **This approved live checkpoint is PASS.** Broader strict-3NF certification, the unrelated migration-history discrepancies, application deployment and managed authenticated UI acceptance are separate work. No live synthetic fixtures or photo uploads were created.

Local verification: API deletion/authorization/input/address/official-form/route suites **257 passed**; shared input/address contracts **46 passed**; admin submit/live normalization **28 passed**; root typecheck **passed**, root lint **passed** with existing React Refresh warnings. `node packages/db-testing/scripts/test-sale-team.mjs` passed **94 counted assertions**, plus expected-rejection probes, on real disposable loopback PostgreSQL, including failed-preflight rollback, invalid role/staff/OST targets, restrictive deletion, generated-target agreement, canonical-email denial, migration replay, preserved name casing and RLS invariants; fixture/server cleanup completed before the success message. Managed Auth/Storage and live writes are outside this checkpoint. No production customer fixtures were created.

## Profile photos: local implementation and release boundary (2026-10-14)

The shared photo editor covers all account types through the existing staff account page, customer profile and OST dashboard. Photos are private and are not included in public AA search. Browser input accepts JPEG, PNG and WebP originals up to 10 MiB and rejects decoded images above 40 megapixels. It re-encodes to JPEG with a white background, strips source metadata, preserves aspect ratio, and bounds the longest edge to 512 pixels. The shared contract, API and proposed bucket enforce a maximum saved size of **500,000 bytes (decimal 0.5 MB)**. API validation checks canonical base64, JPEG framing and dimensions; it is not a full server-side image decoder.

Storage is the single source for file paths and metadata: no duplicate application photo table is introduced. Each verified Auth identity owns exactly one fixed path, `<auth-user-id>/profile.jpg`, inside private `afhomes-profile-photos`. Server-side `upsert: true` replaces that object rather than creating another path or deleting the old image before uploading. The request's expected account ID detects an account switch; it never selects the owner or authorizes access. Staff and customer principal resolution remain separate. Forced-password/MFA-gated staff and inactive customers cannot upload. Successful uploads return a fresh short-lived signed URL (300 seconds); API responses use `no-store`. Logout clears private query data, and a late upload response cannot repopulate a cleared query.

Approved and applied migration: **`20261202000001_afhomes_private_profile_photos.sql`**, raw SHA-256 **`04994b615cc268778fcf9cac41ca1b9bc00a1150d3dc81ca253d4a251c8b8116`**. It creates or reconciles only the private JPEG bucket, with a 500,000-byte limit. It adds no browser Storage policy, account, application table or Auth setting. On 2026-10-14, after explicit approval of this exact migration and push, it was applied to `ikaevepedpqygdlipsei` and its committed bucket properties, existing policies and recorded SQL hash were independently verified. The database prerequisite now precedes the dependent API/UI release. Do not use the broad migration runner. Rollback disables the photo API/UI while retaining private objects; never make the bucket public or delete user photos to roll back code.

Local evidence:

- Full offline regression: **3,717 tests passed** across seven workspaces. The subsequently added staff logout-cache regression also passed independently. Final typecheck, lint, build and environment-isolation checks passed; existing React Refresh and bundle-size warnings remain.
- Disposable PostgreSQL acceptance: **95 counted sale-team/integrity/photo-bucket assertions passed**, plus expected-denial probes. The final combined database harness applied all 77 local migrations, passed **2,469 checks** on its normal run, and passed all **13 harness checks**, including injected-failure reporting, nonzero exit and complete fixture cleanup. The intentionally failed run also reached a downstream missing-alias error; it is not a clean acceptance run. The normal run had zero failures.
- Native browser canvas proof: a synthetic 7,707,459-byte PNG became a **95,895-byte JPEG at 512 x 448**; replacement became **95,634 bytes**, with two saves and one current in-memory photo. No console errors. This proves the real shared editor/compressor, not managed Auth or Storage persistence; no live accounts, documents or uploads were created.

The other session's six commits after the photo commit adjust only database fixtures, cleanup ordering and the search-path assertion to match canonical-email constraints, OST roles and issued AA relationships. Their combined state is validated through `d3dbb71`; applied migration SQL and photo implementation were preserved. The separate communications checkout's uncommitted edits were not merged or rewritten. No push or deployment was performed in this verification pass.

Release preflight refreshed on 2026-10-14: the Supabase connector confirmed target `ikaevepedpqygdlipsei` is ACTIVE_HEALTHY, history contains 74 versions with latest `20261201000001`, and the photo version, bucket and objects are absent. Both Storage tables have RLS enabled. All four existing object policies are SELECT-only and explicitly target other buckets; none permits direct photo access. The staff policy remains a singleton with optional MFA. The raw photo migration hash still matches the value above. Remote `claud/develop` advanced to `5398b2a`; its documentation/context changes merged without conflicts and preserved the photo/security code. The SSOT move to `docs/supabase/` is retained and relative business-rules links are corrected. These read-only findings are preflight evidence, not migration execution or managed upload acceptance.

After that merge, all **36 focused photo checks passed**: 23 API boundary/replacement checks, 11 editor/compression checks and two staff/customer logout-cache regressions. No application or SQL implementation changed during remote reconciliation, so the passing full-suite and database-harness results above were retained instead of rerunning large unchanged suites. At that preflight, live acceptance and push were held at the bucket-approval boundary. The user subsequently approved only the named photo migration and push; no synthetic shared accounts or photos are permitted by the current test scope.

Managed authenticated uploads, actual signed downloads, overwrite behavior and deployed account-page acceptance remain **NOT VERIFIED**: the approved bucket is now present, but the user requested local-only synthetic testing. Permanent account deletion does not yet remove its profile Storage object; replacement itself creates no historical paths. Existing document/CMS images are not retroactively compressed. A per-image cap does not guarantee quota capacity: 1 GB holds roughly 2,000 maximum-size photos before other files and overhead, not 50,000. Actual smaller images help, but Storage and egress usage must still be monitored under the existing quota rules.

### Approved photo-bucket execution

On 2026-10-14, only `20261202000001_afhomes_private_profile_photos.sql` was applied using a verified TLS connection to the approved target. Preflight checked its full SHA-256, the configured project mapping, 74-version baseline, absent bucket/objects, optional MFA and all six RLS invariants. No broad runner or unrelated SQL was used.

The first attempt rolled back before commit: the local verifier compared the bigint size limit (decoded as text by node-postgres) with a number. An independent connector read confirmed 74 versions, no bucket and no recorded photo version after rollback. The verifier now explicitly projects the limit as an integer; this changes no approved SQL. The unchanged migration then passed in-transaction verification, committed with its exact version and full SQL body, and passed post-commit verification.

Verified committed result: **75 migration versions**, latest **20261202000001**; `afhomes-profile-photos` is **private**, allows **image/jpeg only**, and enforces **500,000 bytes**. Recorded SHA-256 is `04994b615cc268778fcf9cac41ca1b9bc00a1150d3dc81ca253d4a251c8b8116`. Complete row-count/digest snapshots for every public/private application table, Auth users, Storage objects and all other buckets were unchanged; existing Storage policies were unchanged. All six RLS invariants passed, and the singleton/getter retain `admin_mfa_required=false`. There are zero profile objects.

An independent Supabase connector read confirmed the committed version/hash and bucket metadata. The actual managed Storage SDK `getBucket` and empty `list` calls also passed with the same private/JPEG/size settings. These are read-only platform checks, not real upload, signed-download or replacement acceptance. No test accounts, genuine profile images or business records were created or modified. Rollback remains code disablement with the private bucket retained; do not weaken access or remove existing images.

## Official IST/OST AA numbering: local implementation (2026-10-14)

The user approved `AAIYYMMNNNN` for IST, `AAOYYMMNNNN` for OST and **one shared monthly sequence across IST and OST**. Policy and the other reviewed numbering rules are recorded in [AF Homes business rules](../AFHOMES-BUSINESS-RULES.md#approved-af-homes-aa-implementation-2026-10-14). The first approved accreditation start month controls `YYMM`; renewal/reapproval retains the original number. The four-digit sequence starts at `0001` for a new month and fails closed at `9999`. Existing random AA identifiers remain searchable and visible, without renumbering or automatic backfill.

Pending, local-only migration: **`20261203000002_afhomes_official_aa_numbering.sql`**, raw Windows-worktree SHA-256 **`c15e5ca1c0b5983af4cfccf664071c86d3657ae1a51f41ab987864e0370bc04f`**. The CLI-generated scaffold is ordered after the repository's future-versioned baseline. It creates one private indexed monthly-counter table, a non-callable typed allocator, an AA format/kind CHECK and an immutable-number/owner/kind trigger. It re-delivers the existing approval RPC with only its generator call changed. Approval permissions, account status, effective staff restrictions, forced-password/MFA gates, reviewed names, audit behavior and existing renewal semantics remain. Counters and allocation are inaccessible directly to browser and service roles; the existing service-only approval RPC performs allocation and insertion in one transaction. No new public endpoint, infrastructure, permission vocabulary, financial table or customer-number generation is introduced. The table adds one counter row per used accreditation month; no representative latency gain is claimed.

Read-only shared preflight on 2026-10-14 confirmed project `ikaevepedpqygdlipsei` still has **75 versions**, latest `20261202000001`, no official-AA version/counter table and zero accreditation rows. The live approval function's normalized body SHA-256 matches the local predecessor: `6ffc7ba683d64a26ad173f8e92686cba2e7ac200a83884f8358555649797fe7e`. Its pinned `pg_catalog, pg_temp` path and service-only execution grants remain intact. Optional MFA remains false. This inventory is not live execution approval or representative populated-data proof.

Local evidence: shared contracts accept new and legacy codes, validate month/nonzero sequence and reject a new prefix with the wrong seller kind. API tests cover exact typed lookup, existing authorization and an exhausted-series error without issuance retry. Public-search, IST account and OST dashboard tests cover the new displays while legacy acceptance remains tested. `node packages/db-testing/scripts/test-sale-team.mjs` passed **123 real PostgreSQL checks**, including cross-prefix counters, concurrent same-seller/mixed allocation, month/year rollover, transaction rollback, overflow without a record/audit, format/identity constraints, ACL denials, renewal/reapproval, migration replay and cleanup. The full disposable harness passed **2,470 checks** on its normal run and all **13 harness checks**; intentionally injected failures remained nonzero and cleaned up. Managed authenticated acceptance is separate.

Final clean offline regression passed **3,735 tests** across seven workspaces (805 Admin, 252 Web, 2,175 API, 243 contracts, 213 UI, 41 shared and 6 config), with cache disabled and bounded concurrency. Root typecheck, lint, both application builds and environment-isolation checks passed. Existing React Refresh, jsdom and bundle-size warnings remain; no zero-warning claim is made. No large suite was rerun after documentation-only edits.

**Release order differs from the photo bucket:** first obtain commit/push approval and release the new API/apps that accept both formats, while old SQL continues issuing legacy numbers. Verify compatibility for **every active deployment connected to the shared project**, including Production; a compatible Preview alone is insufficient if Production still validates random-only AA numbers. Separately approve any required Production compatibility release; no Production deployment or second project is authorized here. Only after that compatibility gate may the exact new SQL migration receive live apply approval. Applying official issuance SQL while older API/apps enforce the random-only contract can make new account/lookup responses fail validation. Recheck actual deployed SHAs, target/history, complete raw hash, existing formats and approval definition before live apply. Never use the broad runner or include the obsolete directory/catalog versions. Verify new counter/format/immutability definitions, service-only approval execution, browser denials, preserved records/audits, optional MFA and RLS invariants after apply.

Rollback keeps dual-format API support, issued AA records, audit history and counter high-water marks. Disable new issuance while repairing forward; never reset counters, downgrade to random-only validation after official issuance, or renumber/delete identifiers. Customer/VIP/IGP allocation, new products, JA&D identities and financial/upgrade rules remain outside this release. No live accounts or synthetic records were created, no new migration was applied, and no commit/push/deployment is performed by this local implementation.

Privacy limit: the new date/sequence format is guessable. Exact lookup continues returning only approved public name, IST/OST kind, AA number, current status and validity dates; it provides no contact, financial, account UUID or private-image data. The existing 30-search/minute limiter is per server instance and does not prevent distributed enumeration. Edge throttling/public verification policy needs separate review before broad rollout; numbering is never an authorization factor.

## Approved AF Homes numbering: local release gate (2026-10-14)

Annual customer IDs, official VIP control numbers and shared monthly IST/OST numbering are implemented locally. The approved decisions and preserved source draft are in [business rules](../AFHOMES-BUSINESS-RULES.md). JA&D/IGP, dual-company accreditation, N contracts, extra tiers and supersession/upgrade workflows remain pending. Historical IDs, AF-CC codes, payment/member references, commercial snapshots and evidence are preserved.

Read-only shared-project check: `ikaevepedpqygdlipsei` (AF homes) remains ACTIVE_HEALTHY with **75 versions**, latest `20261202000001`, no new numbering versions/tables, and administrative MFA **false**. No shared SQL, Auth, accounts or business records were changed.

Read-only Vercel recheck on 2026-10-14: existing CLI credentials verified team `afhomes`, project `afhomes-ecofarm-v2`, Production branch `main` and current READY Production SHA `52efaf5dc05db39eb1b59595b22bec71f068b08e`. `claud/develop` remains a Preview branch. Production and Preview URL mappings match the approved shared Supabase project; the administrative MFA environment flag is absent. The connector returned 403 for team access, but the existing sanitized CLI verifier succeeded without credential changes. [Recorded metadata](../security/evidence/checkpoint-vercel-verification.json) contains no credential values. This inspection does not prove that Production accepts the new identifier formats; that gate remains before SQL approval.

Exact pending manifest: SHA-256 of raw Windows working-tree bytes, all three files using CRLF:

| Order | Migration | SHA-256 |
| --- | --- | --- |
| 1 | `20261203000002_afhomes_official_aa_numbering.sql` | `c15e5ca1c0b5983af4cfccf664071c86d3657ae1a51f41ab987864e0370bc04f` |
| 2 | `20261204000001_afhomes_official_customer_numbering.sql` | `0daa76c13229ffc9a31b7641c8d6848c184560ddd8971be6c3183535195c3e17` |
| 3 | `20261204000002_afhomes_official_vip_numbering.sql` | `3602745e8da966c89914ef620015a1ca009a676fecc545565ded6099a89599cf` |

The private annual counters are bounded at 999999 customers / 99999 VIP purchases; AA uses one monthly counter bounded at 9999. The immutable VIP registry freezes tier/payment/term/date/sequence, original purchase source, seller and optional AA snapshot. Guarded parent pointers and foreign keys retain referential integrity. Service-only RPCs commit creation, number, audit and durable retry receipt together; direct sales also commit their pending commission. A draft reserves no VIP number. Signed execution allocates once; finalization and later sale-origin agreements reuse it. Number issuance neither verifies money nor activates membership. Customer/application/reservation history blocks account deletion before dependent account rows are removed. The established owner-only cleanup escape is used exclusively on disposable fixtures, without resetting counters.

Local publication gate on 2026-10-14: a fresh bounded full offline run passed **3,757 tests**, followed by two pre-migration search cases and a final **2,196-test API workspace pass**. Final aggregate across workspaces: **3,759 passing tests** (API 2,196, Admin 806, Web 252, contracts 245, UI 213, shared 41, config 6). Root typecheck, lint, build, environment isolation and Git whitespace checks passed. The 26-case sale/customer numbering regression file covers atomic replay, legacy compatibility, missing/stale RPCs, private-column absence, malformed allocators, authorization/dependency denial and search behavior. Existing React Refresh/jsdom/bundle warnings remain. An earlier ad hoc Turbo invocation omitted the repository worker cap and hit three UI waits; configured-equivalent fresh execution (`turbo run test --force --concurrency=2 -- --maxWorkers=2`) and sequential execution passed without changing timeouts or coverage. Unrelated formatting in the SQL integration suites was restored, with formatted-content comparisons proving that their tested statements were preserved.

Real disposable PostgreSQL: **2,480 normal checks PASS**, **13/13 fail-closed harness checks PASS**, and **157 focused numbering/normalization checks PASS** after final raw-file normalization. Coverage includes annual/monthly boundaries, bounds, concurrency, rollback, retry reuse, cancellation retention, raw audit redaction, forced-password denial, draft non-issuance, reservation-to-sale/evidence reuse, private ACLs and preserved payment/member gates. A second sale cannot claim a previously issued number: the source binding and unique sale-number pointer enforce this in SQL. Cleanup now removes only synthetic customer aliases by their recorded IDs, fixing the extra legacy-alias failure documented in earlier runs. The injected run reports only its intended deliberate fault, exits nonzero and completes cleanup. Every tracked fixture table returns to baseline. These checks do not emulate managed GoTrue/PostgREST/Storage or prove a deployed browser flow.

Required staged release:

1. Publish the reviewed API/apps to `claud/develop` Preview only after commit/push authorization. The complete branch accepts both AA formats and preserves the old customer/sale creation path only when the exact new RPC is missing. Sale fallback additionally requires the new VIP column to be absent; customer fallback refuses an annual official number from the new allocator. A stale RPC cache after migration, authorization denial, missing dependency or unrelated database failure cannot trigger legacy issuance. Official-number searches return an empty result before the column exists. No SQL runner executes during the build. Verify the compatible artifact across every active deployment sharing Supabase before official AA issuance, including Production; a compatible Preview alone is insufficient. No Production deployment is authorized here.
2. Separately approve the exact three-file manifest, recheck target/history/full raw hashes, current function bodies/grants, prerequisites, record/evidence digests and optional MFA, then apply only the listed order. Verify each successful version and stop on any error. Preserve `admin_mfa_required=false`. Do not use the broad runner, invoke legacy renumbering routines or include unrelated index/directory/catalog files.
3. After SQL verification, confirm the already-published API/apps use the new atomic RPCs, with no legacy fallback. Direct-sale clients must supply and retain their mandatory request UUID. Reconcile all old direct-sale writers during the controlled cutover; older APIs can create legacy sales without an official VIP number and cannot remain active issuance paths. The temporary fallback preserves existing non-atomic writes before migration; it does not claim durable retry receipts or atomic sale/commission/audit commit until the new RPC is available.
4. Perform separately authorized managed acceptance: account/recovery/MFA access, account/public AA display, direct-sale retry/reload persistence, signed reservation reuse, frozen prints, permission/ownership denial, cancellation retention, financial/member non-activation and RLS invariants. No live synthetic or actual business transaction is authorized here.

Rollback retains compatible readers, issued IDs, counters, original sources, snapshots and evidence while stopping issuance for forward repair. Never reset/recycle counters, downgrade to random-only AA validators, clear official pointers or rewrite history.

Remaining limits: staged/deployed artifacts and managed acceptance are unverified; commit/push, apply and deployment require approval. Legacy customer callers without a request UUID cannot replay a lost response by request identity, though uniqueness still fails closed. Guessable IDs never authorize access; public AA lookup keeps its minimal payload and per-instance limiter, with distributed enumeration still an operational risk. No IGP, NFC, new infrastructure or second database project is introduced.

Decision: the complete branch supports a compatibility-first Preview release; **NO-GO for live official numbering until the exact SQL batch is separately approved and every shared deployment passes the compatibility gate**. Commit/push does not apply migrations or enable official issuance. The current `develop` branch also contains newer bulk-customer/company-field work; merging that branch requires a separate integration check and must preserve its pending migration.

## Preview regression investigation (2026-10-14)

The user's working reference `afhomes-ecofarm-v2-k5rx8hiju-afhomes.vercel.app` is READY deployment `dpl_hSBdCHecjsqpm48euMUMj57Dm8z7`, branch `claud/develop`, SHA `3ab2d22a1d8960c344084077f653c05e0bd780ce`. The screenshots show `afhomes-ecofarm-v2-p3vy2f1pi-afhomes.vercel.app`, READY deployment `dpl_63FfLXpGPoG5B6ckzYtsgGyC82m1`, branch `develop`, SHA `36bd77b9667bf520bc96f766122ee8e50539b8db`. A READY build alone did not prove privileged API readiness.

Read-only project/deployment metadata confirms `SUPABASE_SERVICE_ROLE_KEY` exists for `claud/develop` Preview and Production, but is absent from the affected `develop` Preview. The public Supabase URL/key remain present, so login/session resolution can succeed through the existing ownership-scoped fallback while privileged business APIs fail. A Git merge does not carry branch-scoped Vercel variables into another branch. No credential values were printed, exported or written to Markdown.

| Screen / API | `develop` screenshot deployment | `claud/develop` reference |
| --- | --- | --- |
| Dashboard / analytics | HTTP 500, server configuration incomplete | Analytics and sales-trend HTTP 200, overview rendered without the load-error panel |
| Reports / sales | HTTP 500, server configuration incomplete | HTTP 200, Reports rendered without the load-error panel |
| Activation Queue | HTTP 500, server configuration incomplete | HTTP 200, queue rendered without the load-error panel |
| Audit | HTTP 500, server configuration incomplete | HTTP 500 with a second confirmed query defect, `PGRST201` |
| Staff profile photo | HTTP 503 | HTTP 200 |

Runtime logs on the reference deployment identify the Audit defect: both `staff_role_assignments.staff_id` and `staff_role_assignments.assigned_by` reference `staff_users`, so the unqualified embed is ambiguous. The corrected Audit, OST sponsor-picker and OST import sponsor queries explicitly select `staff_role_assignments_staff_id_fkey`, and accept the managed one-to-one object shape as well as legacy array fixtures. Browser authorization, private data redaction and sponsor eligibility checks are preserved. A managed read-only PostgREST probe requested `limit=0`: old query returned HTTP 300 / `PGRST201`; corrected query returned HTTP 200 / zero rows. No customer, financial, account or import data was created or changed.

Local prevention: the existing Vercel preparation script now exits nonzero for Preview/Production builds missing required server/public Supabase configuration, logging variable names only. Offline local builds still work without remote credentials. Tests first reproduced the old false-success build and ambiguous Audit query, then passed after the fixes. The fake now resolves named reverse FK relationships; Audit/OST tests assert the real relationship and one-to-one role shape instead of silently accepting an unresolved embed. This is a configuration prerequisite gate, not proof that a supplied key is valid or that every workflow works.

Final affected verification: **2,203 API tests PASS**, including 108 focused report/OST/release checks; root typecheck, build and environment isolation PASS. The other workspaces are unchanged from the preceding full passing run, yielding 3,766 current tests across the retained workspace results. SQL numbering files/hashes are unchanged, so the prior disposable PostgreSQL evidence still applies; no extra SQL test batch or shared write was needed for these query/configuration fixes.

Operational repair requires separate approval: add **only a Preview variable scoped to Git branch `develop`** named `SUPABASE_SERVICE_ROLE_KEY`, using the existing approved project's server credential through the authorized settings/CLI workflow. Do not make it global, public or `VITE_*`; do not change Production, Auth, MFA, database settings or any other variable. Inspect branch precedence and name/target presence without exposing the value. Previously created deployments retain their old environment snapshot; a newly authorized Preview build is required after the setting and reviewed source fixes are available. Do not merge or deploy an unreviewed branch as part of this configuration repair.

After publication, require authenticated read-only browser/API checks for Dashboard, Audit, Reports, Activation/Payment queues and the changed OST reads; verify HTTP success, contract-valid data/empty state, authorization denials, reload and runtime errors before claiming a full release pass. A successful build, unit suite or login is insufficient. Rollback removes only the newly created `develop` Preview variable if its scope is wrong and restores a reviewed Preview artifact; preserve the existing `claud/develop`/Production settings, all data and SQL, and never widen browser grants or bypass authorization to remove a load error.

Status: local fixes are prepared for the next reviewed commit. The failing live deployment remains unresolved until scoped configuration/publication approval and acceptance. No commit, push, merge, Vercel setting change, deployment or new live migration was performed in this investigation.

### Approved configuration checkpoint (2026-10-14)

The user subsequently approved adding the existing server key to `develop` Preview only. Revalidated team `afhomes`, project `prj_apBNxtW4R8E7JohbFg6K8aUGin4j`, Production branch `main`, exactly one existing `claud/develop` Preview server key, and no existing global/`develop` Preview server key. Vercel's existing Secret is non-readable; the existing authorized local credential was verified as service role for `ikaevepedpqygdlipsei` with a successful managed `limit=0` read. No key was generated or rotated.

Created exactly one non-readable Secret: `SUPABASE_SERVICE_ROLE_KEY`, target `preview`, Git branch `develop`, variable ID `Q0iivy4DPlWlxurv`. Submitted the value through process stdin, without a secret in command arguments, logs, temporary files or Markdown. The project environment count changed from **15 to 16**; every prior variable's ID/name/type/targets/branch/update timestamp remained unchanged. Production, `claud/develop`, public variables, Auth, MFA and SQL were untouched.

This approval was for the scoped configuration change only. No commit, push, merge, Preview/Production build or deployment was performed. Existing deployments still use their original environment snapshot. A newly authorized Preview build of the reviewed fixes and authenticated acceptance are still needed before claiming the live problem resolved. Configuration rollback, if separately required, targets only variable ID `Q0iivy4DPlWlxurv` in this project/team; never remove the existing `claud/develop` or Production variables.

The user subsequently authorized committing and pushing the reviewed numbering, Audit/OST relationship fixes, regression checks and deployment configuration guard to `claud/develop` for its Git-triggered Preview. This publication authorization does not apply the three pending SQL migrations, merge into `develop`, or promote/deploy Production. Official numbering remains inactive on the shared database until the separate SQL and compatibility gates are approved.

### Cross-session migration reconciliation after publication (2026-10-14)

Published commit `6a3c735efc84a852c773e94a88766d81543ffed7` to `claud/develop`; its Preview `afhomes-ecofarm-v2-bmkfh2q3f-afhomes.vercel.app` is READY (`dpl_HpHwwf8zREv1RpWfV9brZ15AJiVv`). Production remains READY at `52efaf5dc05db39eb1b59595b22bec71f068b08e`. Deployment metadata alone is not authenticated acceptance of this new artifact.

The shared database now has **76** migration-history entries. Version `20261203000001` was recorded by another session with **no name or SQL statements**, while the official counter/VIP registry remain absent. The live `save_customer_application` function body matches the other session's application-hierarchy SQL exactly after newline normalization: SHA-256 `d6b60efc281b5c7a1ea559bf83b10e2096f7828afb676a5bf5591ceb7f3a109f`. Browser execution remains denied; service-role execution remains allowed; administrative MFA remains false. This establishes an object match, not a complete historical SQL manifest. Do not rewrite or delete that applied history entry during numbering release.

The AA file was therefore renamed from the **unapplied** `20261203000001_afhomes_official_aa_numbering.sql` to **`20261203000002_afhomes_official_aa_numbering.sql`**. Its SQL bytes and raw Windows SHA-256 remain unchanged (`c15e5ca1c0b5983af4cfccf664071c86d3657ae1a51f41ab987864e0370bc04f`). The exact numbering order is now AA `20261203000002`, customer `20261204000001`, VIP `20261204000002`, with the same three hashes in the manifest above. Recheck all versions and object definitions immediately before any approved apply; no broad runner is permitted.

Reviewed the other session's checkout without modifying it. Its `afhomes-access.ts` security behavior and `afhomes-access-security.spec.ts` tests already match this branch; no duplicate security implementation or test file was added. Reverified those **ten existing cases** for unavailable authorization lookups, mandatory/optional MFA and failed policy reads; **42 affected API cases PASS** including release/numbering checks. The renamed migration also passed **157 disposable PostgreSQL checks** with cleanup, and API typecheck passed. No runtime authorization behavior or MFA setting changed during this review.

Do not wholesale include the other checkout: its application hierarchy API/contracts need its new UI, but the UI edits target a retired 3,900-line monolithic `OfficialFormsPages.tsx`, conflicting with this branch's split form modules. Reintegrating requires porting those changes into the existing modules while retaining official numbering and tests. Its earlier hierarchy migration uses `20261130000001`, which actually belongs to the already-applied sale-team accreditation; the `develop` company-fields migration also uses that occupied version. The other checkout edits the historically applied communications migration and contains unrelated fixture/dependency/temporary work. Exclude those until their owners reconcile versions, forward-only SQL and focused release scope; never import temporary probes or overwrite the current API/profile/numbering work.

**Live numbering gate: NO-GO.** Current `develop` still uses the legacy-only AA contract. Current Production `sales.ts` directly inserts sales/commissions and does not call `submit_card_sale_once`, so it can bypass official VIP issuance after the SQL cutover. A compatible `claud/develop` Preview does not close those active shared-project paths. Separately authorize/review compatibility publication to each active deployment, then approve the updated exact three-file SQL manifest. This conditional migration request does not justify an apply while those prerequisites fail. No live SQL or business data was changed by this reconciliation; no other session's hierarchy feature or company-fields migration was merged or applied here.

## Company direction: Supabase and possible MongoDB version 2

Per the company context supplied by the user, the company originally uses MongoDB. The initial direction is to keep version 1 running on Supabase while preparing a possible version 2 using MongoDB. Supabase may therefore be temporary or permanent, depending on company rules and the final approved architecture decision. **No database replacement or cutover is approved or performed by this document.** Repository names containing `v2` do not establish which business release the company calls version 1 or version 2.

Until that decision, Supabase is the authoritative persistence layer for this implementation. Keep shared contracts, effective permissions, exact money, ownership and frozen history explicit so a later implementation can reproduce them. MongoDB does not automatically replace Supabase Auth, private Storage, PostgreSQL transactions, SQL RPCs or RLS: those responsibilities need deliberate equivalents. Avoid adding speculative dual writes or a database abstraction layer now.

A future migration requires a reviewed mapping, preservation of identifiers/history/financial integrity, authorization equivalence, Auth and file strategy, verified export/import and reconciliation, rollback, and a controlled cutover. Keep one authoritative writer through cutover. Company approval determines whether that version proceeds or Supabase remains permanent.
