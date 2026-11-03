# Phase 5 continuation: catalog and VIP account foundation

**Historical checkpoint. Latest implementation and evidence:**
[Phase 5 integration report](PHASE5-INTEGRATION-REPORT.md). The remaining-work
list below describes the earlier foundation checkpoint, not current code.

25 October 2026. Local `claud/develop` work only. **Phase 5 remains IN PROGRESS.**
The user confirms the administrator was already bootstrapped. Its identity,
password and assignments were not queried, modified, reset or replaced.

## Implemented and locally verified

- Replaced the incomplete, unmounted `cards.mongo.ts` draft with the typed
  `api/_lib/catalog.mongo.ts` factory and source-preserving catalog read models.
  IDs and references are UUID strings, not ObjectIds. Category/plan create,
  list/detail, edit and activate/deactivate operations preserve existing response
  schemas, exact money strings, economics validation and seller visibility.
  There is no catalog DELETE operation. Mutations and their audits share a
  transaction; referenced historical sales/memberships are not rewritten.
- `api/_lib/customer-activation.mongo.ts` implements 72-hour VIP activation
  code/link issuance, rotation of prior tokens and atomic redemption. Links use
  fragments; only SHA-256 token hashes are stored. Eligibility, purpose,
  consumption and expiry are checked again inside the transaction. Customer and
  membership writes serialize conflicting activation/lifecycle operations.
- New identities use pinned Better Auth Mongo model fields and Better Auth's
  password hashing. Identity, credential, customer link, token consumption and
  source audit events commit together; no identity/session creation is delegated
  to an independently committed external transaction. Actual Better Auth login
  and persisted cookie session resolution prove the resulting credentials work.
  These pinned model writes must be reviewed with adapter/schema upgrades.
- Existing orphan identities can link without replacing their password. Existing
  staff/admin identities, pending staff associations and identities owned by
  another customer are refused. A synthetic existing-admin fixture verifies its
  identity, credential hash and role assignment remain unchanged.
- `api/_lib/customer-handlers.mongo.ts` provides explicit unmounted activation,
  staff token-issue and customer portal factories. Staff issuance requires the
  server authorization capability and a trusted mutation origin. Responses are
  non-cacheable; exceptions do not disclose driver details.
- Portal profile, active membership, legacy points summary and payment-history
  reads derive ownership from a real provider session on every request. Caller
  customer IDs are ignored. Suspension affects the next protected request;
  suspended customers retain their own read-only profile, matching source.
  Explicit projections/mappings omit government IDs, TINs, credential hashes,
  receipt paths, staff identifiers and private Finance notes.
- VIP delivery currently returns the existing `manual_required` result and
  activation link. No real invitation or email is sent. Staff onboarding remains
  the separate temporary-password/forced-change workflow.
- A new `api/_lib/testing/mongo-replica.ts` fixture creates a genuinely disposable
  loopback replica set per run. It does not read environment credentials, reuse
  a developer database or delete a fixed shared test-data directory. Tests check
  the replica-set handshake before using transactions.

## Verification

- New Phase 5 integration tests: **16 PASS** across three files. Actual MongoDB
  transactions, indexes, Better Auth login/session checks and native loopback
  HTTP are involved, not only a fake database adapter.
- Focused integration plus unchanged route coverage: **20 PASS across four
  files**. Route coverage was preserved: unmounted factories live under `_lib`,
  rather than masquerading as active `_handlers` endpoints. No coverage bypass.
- Cases include token rotation/expiry/purpose/replay, concurrent redemption,
  audit-failure rollback, orphan-password preservation, bootstrap-admin protection,
  cross-customer/identity-injection refusal, trusted-origin denial, exact catalog
  prices/visibility, source response schemas, suspension and HTTP reload reads.
- Full API suite: **2,778 PASS / 149 files**, exit 0, two workers, no timeout,
  assertion, skip or retry configuration changes. An earlier run alongside
  TypeScript hit two existing five-second workbook limits; the subsequent full
  run without competing checks passed. A prior broad run also caught unregistered
  draft-handler files; replacing them with library factories fixed the cause.
- Full workspace/operator typecheck: **PASS**, exit 0, seven workspace tasks
  (API fresh, six cached) plus operator TypeScript. Final targeted typecheck and
  focused integration checks are recorded in ignored `.phase5-*-final.log` files.
- Source/built environment isolation: **PASS**, 701 browser and 321 server files
  plus existing built assets checked. No browser/environment files were changed.
- New TypeScript files formatted with the repository's Prettier configuration.
  Frontend lint/build/unit suites were not repeated: frontend code is unchanged.
  Native HTTP reload proof is not a real browser acceptance test.

Evidence: ignored `.phase5-baseline-types.log`, `.phase5-focused-final.log`,
`.phase5-api-tests-final.log`, `.phase5-typecheck-all.log`,
`.phase5-typecheck-final.log` and `.phase5-env.log`.

## Remaining Phase 5 work and integration blockers

1. Port staff customer directory/filter options/detail/create/update with ALL
   company fields, masking, business-number generation, eligibility and financial
   category/filter semantics. Do not reduce the existing directory to generic
   Mongo CRUD. These active source routes still use Supabase.
2. Port the advanced points-position/period/allowance rules, ledger pagination
   and membership secret rotation. Only the legacy summary is implemented here;
   unsupported routes fail closed. Do not fake dashboard position totals.
3. Verify the Mongo staff/session boundary before wiring these factories into
   the application. The existing resolver still constructs ObjectIds from UUID
   identities. Its verifier calls provider methods not established by the actual
   pinned API (`getAuthenticationMethods`, `getTwoFactorStatus`) and checks
   bearer headers without an enabled bearer plugin. The source permission/MFA
   semantics must be ported and proved; test-supplied authorization capabilities
   do not prove that integration. No change to the bootstrapped admin is a fix.
4. Active router/browser providers still use Supabase. Connect only converted,
   authorized routes in a separately controlled local runtime, preserve the UI,
   then verify actual customer activation, sign-in, dashboard and reload in a
   browser. No Atlas or browser workflow acceptance is claimed here.
5. The older OpenCode `local-mongodb.mjs` remains standalone despite its replica
   description. Earlier collection setup mixes camelCase fields/ObjectIds with
   snake_case/string-ID services. Do not apply it to shared data or treat its
   earlier passing sections as transaction or schema compatibility proof.
6. Real transactional delivery/outbox and production storage/provider decisions
   remain separately scoped. No messages or external setup were attempted.

The parity ledger was corrected where it invented catalog DELETE, customer
self-edit and verified-only payment-history behavior. Source behavior remains
the authority. Redemption and operational Services remain disabled.

No Atlas requests or existing-database writes, source-repository changes, secrets
edits, data migration, bootstrap, commits, pushes or deployments were performed.
