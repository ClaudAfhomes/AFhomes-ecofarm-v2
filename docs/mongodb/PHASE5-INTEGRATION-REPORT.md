# Phase 5 integration checkpoint

**Active workspace update, 26 October 2026:** work continues in the source
repository on local `claud/mongodb-conversion`. See
[workspace handoff and fresh verification](WORKSPACE-HANDOFF.md). Results below
describe the preceding separate-workspace checkpoint; they do not imply a push
or full production cutover.

25 October 2026. Local `claud/develop`. **Browser acceptance remains pending.**
The previously bootstrapped administrator, password and assignments remain untouched.
All test writes use newly created loopback MongoDB replica sets, never Atlas.

## Implemented

- Native customer directory/filter options/detail/create/update preserve source
  company and supplementary fields, masked government IDs, authorized detail TINs,
  source-derived financial categories, verified-payment totals across sales and
  open reservations, search, filters, sorting and pagination totals.
- UUID document references, random AF-CUS/AF-CC identifiers, company customer IDs
  and VIP numbers use transactional allocation and unique indexes. Audits omit
  confidential identifiers. Historical sale snapshots remain unchanged.
- Customer points position now includes anniversary periods, one-time annual
  reset, debt, annual earning caps, reserved points and weekday/weekend allowances.
  Ledger pagination has a stable bigint-compatible tie-breaker; credentials rotate
  atomically with ownership/status checks and store hashes only.
- Native staff resolution uses actual Better Auth cookie sessions, UUID
  associations, persisted MFA policy, active staff/roles/modules and deny-only
  restrictions. It re-resolves every request. Admin/Super Admin assurance requires
  successful verification for the current session, not just enrolled TOTP.
- Controlled native HTTP runtime handles converted catalog, customer and portal
  routes, staff self-session/profile/password changes, portal selection and raw
  identity transport. Business mutations enforce trusted origins. Unconverted
  endpoints return an explicit failure; there is no Supabase fallback.
- Temporary-password staff sessions can read their self-session but cannot use
  business modules. A successful current-password check changes the password,
  clears the forced-change flag and revokes other sessions transactionally.
  Staff invitations and passwordless onboarding remain unmounted.
- Explicit `VITE_AUTH_PROVIDER=mongodb` selects cookie-based admin/customer
  providers and API clients. Default runtime remains Supabase. Existing React
  screens/layouts, contracts and module flags are retained. Cookie identity changes
  clear the old principal and cached private records before new permissions load.
- Native MFA/recovery forms use existing UI primitives. Recovery supports an
  injected server delivery capability and real provider callbacks; no external
  email delivery has been configured or sent.
- `corepack pnpm dev:mongodb:local` creates a fresh synthetic replica set and
  launches isolated frontend/API ports without loading root `.env.local`.
  Its fictional QA staff account is separate from the existing administrator.

## Current evidence

- Focused native integration: **13 PASS / 4 files** before the added recovery/MFA
  challenge cases. Actual transactions, indexes and HTTP/cookie boundaries.
- Full API suite: **2,793 PASS / 153 files**, including the added recovery callback,
  single-use reset/session revocation and fresh-login TOTP challenge cases.
- Client/session regressions: **5 PASS / 2 files**, including old and structured
  incorrect-password envelopes, genuine session expiry, cache clearing before
  account switching, and unauthenticated MFA pending state.
- Recovery form: **4 PASS**, missing/rejected token, mismatch, successful secret
  clearing and sanitized provider failure. Config validates the provider allowlist
  and excludes MongoDB/Auth secrets from browser configuration.
- Workspace typecheck passed before the final regression additions. Final
  typecheck/lint/build and full frontend results are recorded when completed below.

Ignored evidence logs: `.phase5-resume-api.log`, `.phase5-resume-tests.log`,
`.phase5-cookie-reauth.log`, `.phase5-cookie-session.log`,
`.phase5-complete-types.log`.

## Supabase read-only comparison

The connector lists only an unrelated inactive project and denies access to
`ikaevepedpqygdlipsei`, including after reconnection. The already signed-in Chrome
session exposes the correct **Afhomes-platform / AF homes** dashboard. Read-only
inspection confirmed Healthy status, production `main`, Tokyo region, UUID
customer/identity references and existing company/supplementary customer fields.
The function list contains source activation issuance/claim, customer directory,
points position/allowances, credential reissue and Finance activation functions.
Only metadata and a displayed activation definition were read. No SQL/RPC was
executed, no definition saved, no account/data exported and no settings changed.
This is a partial live comparison, not a full schema/function-body equivalence audit.

## Remaining acceptance and boundaries

- Complete real-browser forced password change, staff directory/edit and VIP
  activation/login/dashboard/reload proof. Earlier browser execution reached the
  forced-change form but displayed a misleading expired-session message for an
  incorrect current-password response. Shared error handling now preserves the
  actual reauthentication error; regression tests prove both envelope versions.
  Browser credential creation/change requires the user to complete the form.
- Native customer deactivation/permanent deletion, identity documents, photos,
  sales/membership staff views and employee accreditation remain unconverted.
  These surfaces must not be reported as accepted because core customer CRUD passes.
  Preserve business-history protections; do not port an unsafe cascade as a shortcut.
- The old unmounted `createStaffBusinessRecord` helper and old collection setup
  still use incompatible ObjectIds/camelCase. They are not used by this runtime.
  Do not mount them or apply old setup scripts to shared data.
- Default production router/dev server still use Supabase. The controlled local
  runtime is intentionally limited to converted routes. Later continuation phases
  6–13 (network, purchases, Finance, storage, reports and cutover) are not complete.
- Real recovery delivery/storage/provider operation and production readiness are
  not established by synthetic tests. Redemption and operational Services stay off.

No Atlas/existing-database writes, existing-data migration, real-admin bootstrap,
secret edits, source-repository changes, commits, pushes or deployments.
