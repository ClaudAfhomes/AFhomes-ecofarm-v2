# Native purchase and IST reporting checkpoint

26 October 2026, `AFhomes-ecofarm-v2`, local `claud/mongodb-conversion`.
This is local implementation evidence, not authorization for Atlas initialization
or a declaration that the whole platform has completed conversion.

## What was repaired

The previous native integration test contained an unconditional `expect(true)`
where the complete workflow should have been executed. It has been replaced by
real cookie-authenticated HTTP requests against a fresh loopback MongoDB replica
set. Supabase-fake tests remain useful source regressions, but do not establish
native persistence or transaction correctness.

The native purchase implementation now preserves the current source behavior:

- Registration and application creation use request identities, safe retries,
  canonical AF identifiers, company IDs, current catalog snapshots, authoritative
  linked staff names and hierarchy validation. Company-stated fields are mirrored
  onto the customer; they never determine the commercial price. Government IDs
  remain write-only and are excluded from audits and purchase evidence.
- Submission requires consent, the primary signature and one primary holder.
  Proposal hashes are computed from server-resolved terms. Frozen terms are
  versioned; catalog or commission changes cannot rewrite a finalized purchase.
- Approval atomically reserves, submits and executes the agreement and records
  the source's automatic `10000.00` cash reservation fee. The fee is **recorded**,
  not verified. Reservation execution does not reintroduce the signature gates
  removed by the latest source migrations.
- Payment recording/verification, financial summaries, finalization and
  membership activation use exact-decimal arithmetic and the original payment
  rows. Full verified payment and no undecided payments are rechecked before
  finalization. Membership activation allocates zero initial points; commissions
  still require the source's separate manual qualification.
- Finalization copies frozen economics, captures the complete sale-time
  hierarchy and creates document evidence within the transaction. HTTP success
  is buffered until commit. Audit/evidence failures abort the entire mutation.
- Request UUIDs and payload hashes reject changed-payload replays. Serialized
  native sales/purchase mutations and database uniqueness prevent duplicate
  sales on concurrent finalization. The legacy sale-origin agreement path is
  implemented with its original seller ownership and lifecycle checks.
- All five purchase evidence kinds render from captured, allowlisted fields.
  Evidence is append-only through these handlers. Unique indexes prevent duplicate
  revisions; **they do not prevent an independently privileged database writer
  from updating an existing document**. This is not PostgreSQL-trigger proof.

These changes are in `official-forms.mongo.ts`, `purchase-records.mongo.ts`,
`application-records.mongo.ts`, `sale-hierarchy.mongo.ts` and `sales.mongo.ts`.
The Supabase handlers and migrations were used as the behavioral reference.

## IST portal and employee identity

Native `GET /ist-portal` now supplies the existing dashboard, personal/team sales
and commission views using the existing report contract, filters, pagination,
effective module permissions and genealogy projection. Team reporting requires
both current authorized membership and frozen sale-time attribution. It never
reconstructs historical attribution from today's hierarchy. Native sale creation
now explicitly stores the source's `origin: normal` default.

`GET /sale-team/me` reads only the signed-in account's existing accreditation.
It returns the source's null/not-issued result when no identity exists and
preserves revoked/inactive/OST-term status checks. It neither issues an AA number
nor mounts public verification or administrator approval. Profile photo delivery
remains unavailable and returns the source-permitted null photo.

## Executed proof

`api/_handlers/official-forms-integration.spec.ts` uses a new disposable replica
set and synthetic Sales Manager/Finance accounts, real sign-in cookies and actual
server-enforced first password changes. It exercises:

1. Customer/application creation, proposal, submit/retry, automatic approval,
   recorded versus verified fees, the remaining payment, simultaneous finalization,
   frozen commission/hierarchy, membership activation, VIP token redemption and
   customer login/portal reads.
2. Unauthenticated and unauthorized mutation denials with persisted-state checks.
3. Approval audit failure rollback and retry, plus append-only reservation evidence.
4. Concurrent payment retry, changed-payload rejection and verification evidence
   failure rollback, including payment status, spot-cash state, audit and receipt.
5. All five evidence contracts/PDFs, frozen amounts and private-field exclusions.
6. The legacy sale-origin create/edit/submit/reopen/execute workflow.
7. Registration retry, prospect status, identifiers, company mirror, catalog price,
   government-ID exclusion and refusal of incomplete submission.
8. IST module denials, personal totals, frozen team attribution, transfer scope and
   preservation of historical snapshots.
9. Identity self-ownership, no-record and revoked outcomes; public search stays
   unavailable.

Browser acceptance is deliberately narrower: synthetic staff login, the actual
IST dashboard and identity panel, authenticated reload persistence and an empty
warning/error console were observed in Chrome. The fixture lacks Sales and
Commission view grants, so its hidden metrics were expected. A complete purchase
through the React forms and Finance screens has **not** been browser-verified.
The disposable server was stopped after verification. No real administrator was
used. Ignored screenshot: `.tmp-bin/mongodb-ist-browser-proof.png`.

| Check | Result and evidence |
| --- | --- |
| Full API, final code | **PASS, 2,843 tests / 161 files**, exit 0: `corepack pnpm --filter api exec vitest run --maxWorkers=1`, `.mongodb-api-purchase-serial.log`, 203.35 seconds. Includes all nine real native purchase/IST/self-identity cases above. |
| Earlier parallel full run | **FAIL**, 2,842 pass and one existing 500-row workbook test exceeded its unchanged five-second timeout. The complete single-worker rerun passed without skipping or editing the test. `.mongodb-api-purchase-final.log`. |
| API typecheck | **PASS**, exit 0: `corepack pnpm --filter api typecheck`, `.mongodb-purchase-types.log`. |
| Workspace/operator typecheck | **PASS**, exit 0 earlier in this increment; API rechecked after the final native additions. `.mongodb-purchase-workspace-types.log`. |
| Root lint | **PASS**, exit 0; 32 existing admin and nine web warnings. The root gate covers the SPAs. `.mongodb-purchase-lint.log`. |
| Both SPA builds | **PASS**, exit 0; cached unchanged frontend builds. `.mongodb-purchase-build.log`. |
| Final environment isolation | **PASS**, exit 0; 731 browser / 365 server source files. `.mongodb-purchase-env.log`. |
| Browser slice | **PASS** for synthetic login, dashboard/identity rendering and authenticated reload; warning/error console empty. Full browser purchase flow **NOT VERIFIED**. |

No dependencies were added. No assertions, timeout budgets or security gates were
weakened to obtain these results. The full frontend unit suites were not repeated;
this increment changes native backend paths and disposable fixtures.

## Real database boundary and remaining work

The working tree contained a broad real-development commercial-write allowance
that contradicted `AGENTS.md`. It was removed. The real localhost permits converted
reads and approved account/password/MFA operations; commercial mutations remain
blocked. Newly converted official-form/IST/self-identity reads are allowed.
Database/index setup remains an explicit operator operation, never request-time
initialization. No Atlas data/index initialization, existing-data migration,
administrator reset, invitations, secret output, environment edits, commits,
pushes or deployment occurred in this increment.

The following still prevent whole-platform MongoDB use:

1. Native certified workbook/import persistence and purchase continuation,
   imported-account sales/commission attribution and recovery. The incomplete
   continuation stub now explicitly refuses instead of silently ignoring the
   recovery contract. Native imported-report routes are unavailable.
2. IST/OST registration, accreditation management, renewal, team transfer,
   conversion, complete network member management and public verification.
3. Authorized private document/receipt/photo storage, document review and OCR.
4. Remaining analytics/reports/exports, CMS persistence, settings and background
   jobs. Keep Redemption and operational Services off with their source intact.
5. Full intended-role browser workflow acceptance, then separately scoped
   real-development initialization/enablement approval. Preserve both existing
   administrators and their credentials. Default production routing remains
   Supabase; there is no silent native-to-Supabase fallback.
