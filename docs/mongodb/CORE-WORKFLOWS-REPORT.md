# Native core workflow checkpoint

26 October 2026. Active workspace: `C:\Users\SSD-CLAUD\AFhomes-ecofarm-v2`,
branch `claud/mongodb-conversion`. This extends the Phase 5 checkpoint; it does
not establish full-platform cutover or deployed acceptance.

## Administrator and database boundary

Subsequent authorized update: a separate MongoDB Super Admin was created after
this checkpoint. See [administrator bootstrap report](ADMIN-BOOTSTRAP-REPORT.md).
The following inspection describes the pre-bootstrap state.

The user confirmed that the existing bootstrapped administrator belongs to the
**current Supabase system**. Do not infer that a MongoDB administrator exists.
The approved read-only metadata inspection of `afhomes_dev` found none of the
checked staff, role or authentication collection names. It did not create data,
indexes or accounts. The earlier read-only MongoDB ping passed.

No Supabase administrator, password, assignment or existing data was copied,
reset, replaced or removed. Better Auth cannot authenticate that existing
Supabase account automatically. A separately reviewed identity handover and
explicit authorization for target-database writes remain required. Do not run
bootstrap to hide this gap.

All mutation verification below uses newly created disposable **loopback MongoDB
replica sets**, synthetic accounts and the actual native HTTP runtime. No test
loads `.env.local`, targets Atlas or uses the existing administrator.

## Added native workflows

| Area | Implemented behavior | Boundaries |
| --- | --- | --- |
| Organization | Department/role/staff CRUD, grant-subset and deny-only restrictions, system-role/self/last-Super-Admin protections, staff history blockers, audit reads | Staff creation uses atomic Better Auth-compatible credentials and business records; no invitations. OST creation still requires its dedicated accreditation port. |
| Staff onboarding | Administrator-set temporary password and server-enforced first-login change, current persisted permissions on requests | Existing real accounts remain untouched; private Better Auth admin handler stays unmounted. |
| Dashboard | Native persisted reads with the same extracted source calculation | Shares `dashboard-projection.ts` with Supabase; no invented metrics. |
| Card Sales | Create/list/detail/summary, frozen prices/schemes/commission terms, source seller scope, complete sale-time hierarchy snapshots, draft cancellation | This covers the direct-card-sale path. Application-origin purchase finalization is not ported and is refused explicitly. |
| Payments | Exact-decimal amounts, recorded/verified separation, request UUID and payload replay checks, reference uniqueness, payment verification | Transactional audit and server-computed totals; no client-supplied balance or activation decision. |
| Financial activation | Recheck full verified payment in transaction; concurrent replay creates one membership; hash-only credentials, stable membership number and current period | Zero points at activation per current source rules. No automatic commission qualification. VIP link issuance follows financial commit; failure does not undo payment history. |
| Commissions | Scoped list/detail, prospective staff-over-role rules, inclusive effective dates/overlap checks, rule audit history, manual qualification, paid-reference marker | Frozen prior amounts and beneficiaries are preserved. Paid is a reference marker, not a money transfer. |
| Queues | Finance/activation/dashboard queues, joined sale/reservation previews, verified totals, stable pagination/search | Reservation mutation/finalization APIs remain outstanding. Queue display alone does not prove the reservation lifecycle. |
| Staff membership management | Safe list/detail/print-card output, identifier resolution, atomic print counts, reasoned credential rotation, points account/ledger reads | Secrets appear only on issuance/rotation. Active customer and membership are rechecked before rotation. |
| GSD lookup | Existing `operations.customer_lookup` gate, active/unexpired VIP filters before count/paging, exact allowlisted display fields and points allowances | No membership-number search or response field. Private ID image URL remains null until native authorized storage delivery is implemented. |
| Customer access removal | Atomic suspension, token and Better Auth identity/session removal, audit; financial/member history retained | Refuses shared identities for review. Permanent customer purge/storage cleanup is not implemented. |
| Referral relationships | Immediate role direction, active subject/upline, one active edge, cycle denial, atomic retire-and-replace correction with reason/audit | Past sale snapshots never change. Organization/reference checks share a transactional mutation guard. |
| Genealogy | Same source projection for list/upline/downline/summary and departed-head display; seller detail restrictions; contact reference reads | Source stored-head ordering is retained. No new role hierarchy or broader profile access introduced. |
| Address reference | Existing cached PSGC provider, public rate limits and authorized staff reads through an injected authorization factory | Reuses the source handler; no Supabase business query in the native path. External provider availability still needs browser/runtime acceptance. |

Shared pure mappers/projections extracted from existing handlers are used by both
persistence paths: sale, commission, queue, membership, dashboard and genealogy.
No generic Supabase-client/RPC emulator or silent database fallback was added.
The retained Supabase handlers remain the default application routing.

## Verification

- Full API suite: **2,813 PASS / 157 files**, exit 0
  (`.mongodb-api-full.log`). This includes inherited behavior tests as well as
  real MongoDB/HTTP tests; the count is not 2,813 migrated workflows.
- Final focused Sales/network/address proof: **35 PASS / 3 files**, exit 0
  (`.mongodb-native-final.log`). It includes additional payment/activation audit
  failure rollback checks after the full-suite run.
- Full workspace/operator typecheck: **PASS**, exit 0
  (`.mongodb-conversion-types.log`).
- Root lint: **PASS**, exit 0; existing 32 admin and 9 web warnings
  (`.mongodb-conversion-lint.log`). Root lint currently covers the two SPAs.
- Final native API typecheck: **PASS**, exit 0 (`.mongodb-core-final-types.log`).
  Environment isolation: **PASS**, exit 0; 731 browser and 351 server source files
  (`.mongodb-core-final-env.log`). The touched tracked handlers pass `git diff --check`.
- Earlier source-checkout frontend builds and environment isolation passed;
  no frontend code changed in this core-workflow increment. They are not browser
  acceptance of the new native routes.

Transaction tests exercise duplicate concurrent payment recording/verification,
activation once, print counts, role/staff creation collisions, correction rollback,
preserved immutable sale attribution, financial rollback when audit fails,
VIP code redemption and real-cookie login, deactivation/session invalidation,
GSD filtering before pagination and private-field exclusion, and permission/IDOR
denials. No test failures were suppressed and source security checks remain enabled.

## Still required before using the whole platform on MongoDB

1. Port the full customer application, purchase terms, reservation, signature,
   review/finalization, purchase-document and import-continuation transactions.
   Reuse current source contracts, frozen evidence and latest SQL semantics.
2. Port IST/OST registration, accreditation, renewal, conversion/team transfer,
   Sales Network member management, AA/photo handling and public verification.
3. Implement authorized private document/receipt/photo storage and delivery;
   preserve review/OCR/history and upload validation. Do not expose raw paths.
4. Port workbook/import persistence, analytics/report scoping and exports, CMS
   persistence, remaining organization/security settings and jobs.
5. Replace production runtime dependencies only when every enabled route and
   permission/ownership boundary has native proof. Keep Redemption/Services off.
6. Complete authenticated browser acceptance with intended roles and reload
   persistence. Successful API tests/builds do not establish browser acceptance.
7. Review a concrete administrator/identity handover and target initialization
   separately. No existing-data migration, Atlas writes, bootstrap/reset,
   deployment, commit or push is authorized by this report.

`corepack pnpm dev:mongodb:local` remains a synthetic development runtime, not
an Atlas cutover command. Its original Phase 5 fixture is not a production seed
or an authoritative organization/permission baseline.
