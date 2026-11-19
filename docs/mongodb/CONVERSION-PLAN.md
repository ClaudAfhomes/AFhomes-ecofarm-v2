# Supabase to MongoDB functionality conversion plan

Status: DRAFT for review. Based on source `develop` at
`f512c1416550feaf0c79a6bb204c51d08fa990f6` (25 October 2026).
Phase 1 and unmounted Phase 2A/2B auth experiments are implemented. No existing data is being migrated.
Collection names below are proposals, not collections created in Atlas.

## Boundary and architecture

Keep the React 19/Vite SPAs, REST envelopes, Zod contracts, exact money helpers,
effective permission vocabulary and source UI. Keep the shared API router and
existing handler/service boundaries. Replace persistence domain by domain;
do not emulate Supabase's chainable client or introduce a second business-rule
engine. Do not point new functionality at the source production database.

The Node.js backend owns the official `mongodb` driver. Browsers receive neither
Atlas access nor MongoDB credentials. Phase 1 adds a connection factory and
one explicit ping command; existing business handlers still require Supabase.
`/health` remains the inherited Supabase probe and is not MongoDB readiness proof.
There is no dual-write path and no silent fallback between databases.

## Evidence and dependency audit

See [SUPABASE-INVENTORY.md](SUPABASE-INVENTORY.md) for an exact source inventory.
The initial production-source scan found 7 files importing Supabase packages,
77 files with `.from(...)`, 37 with `.rpc(...)`, 23 using `.auth.*`, and 3 using
`.storage.*`. These counts are file-based and exclude tests; `.from` includes
bucket references and literals omit dynamic names. They are not live schema counts.

| Surface | Current source owners | Conversion requirement |
| --- | --- | --- |
| Browser authentication | `apps/admin/src/lib/supabase.ts`, `apps/web/src/lib/supabase.ts`, session providers, login/recovery/MFA screens | Replace SDK sessions and auth events with backend session endpoints; preserve portal routing, expiry handling and query-cache clearing |
| Server credentials and clients | `api/_lib/env.ts`, `rest.ts`, `auth-verify.ts` | Replace service/anonymous clients only after each handler has a MongoDB implementation; never ship privileged keys |
| Staff authorization | `api/_lib/afhomes-access.ts`, `staff_users`, roles/assignments/restrictions | Re-resolve active principal and effective permissions on every request |
| Customer ownership | `api/_lib/customer-access.ts`, customer activation and portal handlers | Keep ownership independent of staff permissions; apply explicit projections |
| SQL business rules | `supabase/migrations`, handler `.rpc` calls | Translate functions, checks, triggers, uniqueness and locking into validated server services plus transactions/indexes |
| Object storage | `api/_lib/storage.ts`, CMS, receipts, IDs and photos | Selected private S3-compatible object storage with short-lived signed delivery and MongoDB metadata; see `NETWORK-STORAGE-REPORT.md` for implemented photo scope and remaining document workflows |
| Reporting | `api/_handlers/analytics.ts`, `reports.ts` | Authorized MongoDB aggregation, scoped counts/exports, historical hierarchy attribution |
| Operators | `supabase/apply-migrations.ts`, seeds/bootstrap/backfills, `packages/db-testing` | Retain as source reference; never run against source/shared services; design separate future MongoDB administration |
| Realtime/jobs | Polling clients, cleanup/readiness and health jobs | Preserve polling/invalidation; no active browser Supabase Realtime subscriptions identified; separately replace SQL scheduling/cleanup prerequisites |

Source audit only: no live Supabase tables, users, policies, privileges, storage
settings, migration history, or customer data were queried in Phase 1. Migration
files describe intended behavior and cannot establish current production state.

## Authentication decision gate

MongoDB is persistence, not a replacement for Supabase Auth. Two viable approaches:

1. Keep Supabase Auth temporarily while moving business persistence. This reduces
   initial auth changes but retains a hosted Supabase dependency and its user IDs.
2. Use a dedicated identity provider or reviewed backend authentication system.
   This completes independence but requires identity lifecycle, sessions, recovery,
   email and MFA implementation and acceptance before business access is enabled.

Selected direction, confirmed by the user on 25 October 2026: independent backend
authentication with **Better Auth + MongoDB**. Do not invent a home-grown password/JWT scheme.
No password hashes, accounts or sessions will be copied under this phase's scope.

The first backend slice is unmounted and must not initialize against Atlas until separately
authorized. See [the Phase 2 design](PHASE2-AUTH-DESIGN.md); this provider selection
does not authorize database writes or establish completed authentication/RBAC parity.

Required parity before cutover:

- Staff/IST/OST accounts use authorized administrator-set temporary passwords,
  followed by server-enforced first-login password changes. Do not send user
  invitations or replace this flow with emailed initial-password setup links.
- VIP/customer accounts keep their separate single-use, expiring activation code
  or link; the customer activates and chooses a password. This is not staff onboarding.
- Separate staff/customer identity associations, login entry points and portal guards.
- Secure HttpOnly session cookies, Secure in deployed environments, appropriate
  SameSite/CSRF controls, allowed origins, session rotation and revocation.
- Server-side active-account checks, logout-all, deactivation and permission
  changes effective on the next sensitive request; MFA for the existing privileged
  flows, assurance checks, enrollment/recovery and forced-password-change behavior.
- Rate limits, generic account-existence responses, verified email, one-time hashed
  customer activation/recovery tokens and transactional email handling. Preserve
  source-specific verified-email behavior; do not impose invitation email on
  administrator-created accounts.
- Token expiry checked in the query/transaction; a TTL cleanup index is not an
  authorization control. Replayed tokens cannot create or relink accounts.
- Protected-history account deletion, access removal and anonymization stay distinct.

## Permissions and security

MongoDB has no equivalent of application Postgres RLS. Every query and aggregation
must receive a server-derived principal and ownership/organization scope. No
request body may select its own trusted actor, sponsor, role or tenant scope.
Preserve `roles` + `role_permissions` minus deny-only
`staff_permission_restrictions`; system-role protections and assignment subset
checks remain mandatory. Do not invent a role hierarchy.

Maintain existing staff scope helpers and exact role semantics. Customer endpoints
must use the current authenticated customer's record, never staff RBAC as a
shortcut. Explicit output projections must omit government ID numbers, secrets,
private storage paths, internal finance fields and token hashes. Validate all
inputs with existing Zod contracts; construct database filters explicitly to
prevent MongoDB operator injection. Authorization and feature flags must agree
between navigation, direct URLs, API routes, actions and report exports.

## Proposed collections and indexes

Retain source field vocabulary initially to reduce translation errors. Prefer
referenced documents for independently managed and unbounded histories; embed
bounded immutable sale/product/price/hierarchy snapshots. Do not embed growing
payment, audit, import-row, referral or points-ledger arrays in a customer document.

| Domain | Proposed collection groups | Constraints/indexes to translate |
| --- | --- | --- |
| Identity/organization | identities or external subject links, sessions, staff_users, staff_invitations, roles, modules, role_permissions, staff_role_assignments, staff_permission_restrictions, departments | Unique normalized email/subject links, unique role slug/module key and role-module pair; assignment and deny-only uniqueness; account status predicates |
| Customers | customers, customer_onboarding_tokens, identity_documents, customer_applications, customer_application_holders, customer_application_purchase_terms | Unique customer/business numbers and partial identity links; ownership/status lookup; hashed token uniqueness/expiry; versioned human review |
| VIP card sales/Finance | card_categories, card_plans, card_sales, payments, memberships, final_qualifications, commissions, commission_rules, card_sale_hierarchy_snapshots | Unique sale/payment/card numbers; unique sale membership; receipt idempotency; sale/status/time indexes; immutable commercial/hierarchy snapshots |
| Reservations/forms | reservation_agreements, reservation_agreement_holders, reservation_agreement_schedule, document/version metadata | Unique agreement numbers and one-time workflow keys; lifecycle/version checks; frozen signed/generated artifacts |
| IST/OST/network | ost_members, ost_applications, network_member_profiles, referral_codes, referral_relationships, accreditation/renewal records | Unique AA/referral numbers; active ownership links; exact allowed genealogy transitions; cycle prevention; freeze server-resolved sponsor at registration |
| Points | points_accounts, points_ledger, allowance/position records where source requires | Unique account per membership; immutable ledger; unique business event/reference; exact integer balances and conditional nonnegative spending |
| Imports | customer_import_jobs, customer_import_rows, workbook jobs/rows, continuation and payment-claim records | Unique job-row, source fingerprint and per-operation idempotency keys; atomic claims; private originals; resumable audited states |
| Governance/CMS | audit_events, public verification settings/readiness, cms_documents/versions, cms_pages/versions/sections, cms_media_assets | Append-only business audit/version history, source publication rules, indexed subject/time/scope; private/public media distinction |
| Number allocation | counters | Unique sequence namespace; atomic increment; separate business numbers from opaque IDs |
| Deferred, disabled | redemption_items, redemptions, redemption_quotes, earning_claims, service_catalog, purchases, purchase_lines, purchase_payments, point/service refunds, earning/redemption rules, service photos/policies/tier discounts | Preserve code only. No collection/index creation or conversion until separately approved |

An implementation inventory must resolve every SQL table, partial unique index,
foreign key, CHECK, trigger and RPC to an explicit replacement or reviewed removal.
MongoDB validators and unique indexes supplement server validation; they do not
replace cross-document authorization, foreign-key integrity or lifecycle rules.
No indexes or validators are installed by the connection factory or ping.

Driver API/runtime reference checked against the
[official MongoDB Node.js driver documentation](https://mongodb.github.io/node-mongodb-native/)
and its
[Node.js 20.19 minimum runtime release note](https://github.com/mongodb/node-mongodb-native/blob/main/etc/notes/CHANGES_7.0.0.md).

## IDs, values and time

- Proposed internal `_id`: UUID strings from `crypto.randomUUID()`, preserving the
  current UUID REST contracts. Avoid introducing ObjectId strings that break the
  existing validators. Use one representation across references and API schemas.
- Business IDs (customer, sale, payment, membership, AA/accreditation, forms) retain
  source format and namespace rules. Use atomic `findOneAndUpdate` with `$inc` on
  a counter and a unique business-number index. Never allocate using document
  count or max+1. Decide gap policy explicitly; never reuse an issued number.
- Money remains canonical exact-decimal strings in REST and persisted snapshots.
  Use existing BigInt arithmetic; if aggregating with Decimal128, validate precision
  and convert losslessly at the boundary. Never use JavaScript floating-point totals.
- Points use exact integers with an explicit safe range or BSON Long conversion.
  Preserve reversal debt, spendable balance and source allocation rules.
- UTC instants use BSON Date with ISO strings in REST; date-only fields retain
  date-only semantics and current timezone rules. Preserve names/email/token
  normalization exactly as the contracts require.

## Transactions, integrity and idempotency

Use replica-set transactions with `session.withTransaction`, primary reads and
appropriate majority durability. Pass the session to every operation participating
in the unit of work. Never run concurrent operations on one transaction session.
Use conditional updates/version predicates for state transitions; conflicts must
retry through a bounded, tested policy. Add unique business-event idempotency keys
and return the original result on retry. Transaction callbacks may run more than
once: email, storage operations and external side effects require an outbox after
commit, not direct calls inside a retried callback.

| Existing atomic operation | Required MongoDB unit of work |
| --- | --- |
| Payment verification/voiding | Conditional payment transition, authoritative verified totals, sale financial state and audit event; never count recorded/rejected/voided money |
| Sale activation | Recheck full verified payment and customer state; freeze sale hierarchy/terms, create one membership/points allocation/commissions, link customer and append audits exactly once |
| Customer onboarding | Claim unexpired token conditionally, enforce existing identity link, link customer and append audits atomically; identity-provider side effects need an explicit recoverable boundary |
| Application/reservation conversion | Source state/version, unique continuation key, agreement/terms snapshots, payment claims, sale links and audit history together |
| OST approval/accreditation/team transfer | Exact role/permission checks, current state/version, identity/profile links, current hierarchy cycle check, immutable prior-sale attribution and audits |
| Customer/import workflow | Atomic job-row claims, fingerprint/idempotency keys, validated business graph and explicit retryable failures; no cross-customer partial completion |
| Account removal | Protected-history blockers, session/access revocation, identity-provider cleanup with recoverable ordering, audit trail; no cascading deletion of business history |
| Deferred points/service workflows | Keep disabled; later translate reservation/claim/refund/ledger/balance logic as a whole, including concurrency, not separate writes |

Evaluate duplicate requests, simultaneous payment/activation, permission removal
mid-workflow, unknown commit result, transient transaction errors, stale documents,
counter races, deletion with history, token replay and partial external failures.
Source SQL locks cannot be translated into unlocked read-then-write handlers.

## Delivery order and acceptance gates

1. **Phase 1 (current):** independent target branch/snapshot, hidden and blocked
   Redemption/Services, official driver, local secret loading, read-only ping,
   dependency audit and this plan. Report results and stop.
2. **Auth/RBAC gate:** approve identity design; implement sessions, privileged
   temporary-password/forced-change/MFA/recovery, customer activation/ownership
   and all denial cases with synthetic
   accounts in a separately approved disposable/test environment.
3. **Read gate:** organization, catalog, customer/network reads and reports with
   exact contracts, field projections, scoped pagination and index explain checks.
4. **Write gate:** organization/customer changes, applications and reservations,
   then Sales/Finance activation with transactions, idempotency and immutable history.
5. **Network/import gate:** IST/OST lifecycle, referrals/genealogy, controlled imports,
   private files, email/outbox, privacy readiness and cleanup scheduler prerequisites.
6. **Cutover readiness:** browser login-to-persistence flows, isolation/IDOR tests,
   concurrency/retry tests, exact-money comparisons, exports, revocation and failure
   recovery. Remove remaining runtime Supabase dependencies only after parity proof.

No existing-data migration, MongoDB writes, deployment, source changes, push,
production provisioning or identity bootstrap is authorized by this plan.
DigitalOcean sizing, process hosting, reverse proxy/TLS, private storage, secrets,
backups, monitoring and deployment will be a later separately approved task.
Redemption and Services remain off until separately reviewed and authorized.
