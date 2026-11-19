# Direct account creation, applications and lookup

26 October 2026. `AFhomes-ecofarm-v2`, local `claud/mongodb-conversion`.

## Current user decisions

- OST is **created and accredited in one action**, not submitted into a new
  registration/endorsement/approval journey. MongoDB's existing Create OST form
  offers immediate completion only. The retained source's older registration
  code is not mounted as a new native onboarding surface.
- Staff use administrator-set temporary passwords and must change them before
  business access. No invitation or setup email is sent.
- **MFA is removed from MongoDB authentication**, at the user's request. The
  password-change gate, cookie validation, account standing and effective RBAC
  remain enforced. The original Supabase MFA implementation is retained.
- VIP/customer activation continues to use a single-use expiring code/link.

## Implemented native paths

`api/_lib/members.mongo.ts` connects the existing Members console:

- `GET /members`, `/members/:id`, `/members/uplines?position=...` and
  `/members/ost-referrers` return existing contracts, position labels, stored AA
  numbers, masked identifiers and permission-scoped profiles. Ancestor names do
  not authorize opening their private profiles.
- `POST /members` creates an IST login, complete profile, valid immediate-head
  relationship and date-free AAI identity in one MongoDB transaction. It verifies
  the Sales department, active position, assignable permissions, PSGC pair and
  informational OST referrer. A supplied ZIP is retained, as in the source.
- `POST /members/ost` with `mode: complete` creates the OST login, approved
  internal application/form evidence, sponsor relationship, one-year validity
  term and AAO identity atomically. These internal records preserve history;
  they do not add registration steps to the user's workflow. Sponsor endorsement
  fields stay empty because the sponsor did not perform an endorsement.
- Automatic/manual AA modes use the existing allocator/history checks. Replay
  of the same OST request returns the original account; changed payloads and
  duplicate email/phone/AA identities are refused. Passwords are hashed with
  Better Auth's existing helper and never enter audits or replay fingerprints.
- Optional photos use private object storage with MongoDB ownership metadata.
  Account, identity, term, hierarchy, AA and audit writes share the transaction.
  A final audit failure leaves no partial login/account/application behind.

`sale-team-search.mongo.ts` implements native persistence behind the existing
public-search transport and UI. The transport is shared with the retained
Supabase handler rather than duplicating CAPTCHA, token or masking logic.

- `/sale-team/search/config`, `/start` and `/reveal` preserve Turnstile,
  socket-derived IP binding, signed expiring flow/contact tokens, privacy
  acknowledgment, contact deduplication, shared attempt windows and the rolling
  three-successful-disclosure quota. Concurrent updates serialize per IP hash.
- Eligible newly created IST/OST accounts are resolved from current staff,
  role, AA and term records. Public output contains a masked surname and an
  optional short-lived photo URL, not account email, phone, UUID or private
  profile. Revoked, inactive, not-started and expired accreditations are hidden.
- Direct legacy AA reads require authenticated `network.members` access and
  cannot bypass the public disclosure flow.
- Real Node socket identity is now propagated by the native HTTP adapter;
  untrusted forwarded headers are not used for local IP binding.

Application creation and purchase completion use the existing native official
forms workflow. Its real HTTP integration test now also proves that the buyer is
absent from Customer Lookup before activation and present after full verified
payment and membership activation. Customer Lookup remains **staff-only, active
VIP-only**; an application alone or an IST/OST account does not create a VIP.
The lookup returns persisted RA/VIP fields rather than inventing a card number.

## MFA removal

The native Better Auth factory no longer installs the two-factor plugin or its
assurance hook. The raw HTTP allowlist rejects enrollment and verification URLs.
Staff access does not consult an old MFA policy or require assurance records;
the session contract reports `mfaRequired: false`. Existing enrolled flags and
old database records do not block sign-in and are not reset or migrated.

The MongoDB client no longer enters an MFA challenge state or redirects login to
MFA. Visiting `/admin/mfa` in MongoDB mode returns to the dashboard. The retained
Supabase UI and its tests retain their original behavior.

## Local evidence

- Disposable replica-set HTTP tests create both account types and verify stored
  profiles/hierarchy/AA, concurrent OST replay, changed-payload conflict, password
  change enforcement, final-audit rollback, masked public results, revoked-result
  suppression, contact deduplication and rolling quota enforcement.
- The purchase integration test covers the real application-to-activation flow
  plus Customer Lookup before/after activation and anonymous denial.
- Native auth tests prove normal sign-in with legacy enrollment/policy flags,
  unavailable MFA endpoints, temporary-password denial, per-request standing and
  deny-only restrictions. No real administrator is used by tests.
- Chrome displayed the native Members list, Create IST/Create OST actions and
  the direct Create OST form without the pending option. Real JPEG photos and
  new synthetic IST/OST records were created successfully over local HTTP;
  the subsequent list query returned both. Chrome was closed before those new
  rows/public results could be verified visually after reload. Browser submission
  of new credentials and complete browser acceptance are **not claimed**.
- The first broad post-MFA run hit default five-second timeouts under concurrent
  checks. A focused rerun also exposed an overly strict test expectation that
  retry contact-token bytes must match: issuance timestamps legitimately change.
  The regression now asserts the unchanged disclosed result and unchanged quota
  accounting. Native integration cases have an explicit 30-second timeout.

Final verification:

- Full API: **2,873 passed / 165 files**, exit 0, using
  `corepack pnpm --filter api exec vitest run --maxWorkers=2 --testTimeout=30000`.
  This total includes retained legacy/mock tests; the native flow claims above
  come from disposable replica-set HTTP tests, not that aggregate count alone.
- Admin UI: **12 passed / five files** across the creation, session, guard and
  obsolete-MFA-route checks. Original Create OST/Supabase guard coverage remains.
- Workspace/operator TypeScript: PASS. Workspace lint: PASS, with existing
  warnings (32 admin, nine web). Both SPA builds: PASS.
- Source and built environment isolation: PASS (733 browser sources, 378 server
  sources). Scoped whitespace checks: PASS. No environment file was staged.

## Runtime boundaries

`pnpm dev:mongodb:local` starts a new disposable replica set with synthetic seller,
OST and administrator fixtures, private temporary photo storage and a clearly
marked local public-search preview using Turnstile test keys. It never reads
`.env.local`, connects to Atlas or replaces a real administrator. Restarting it
discards the synthetic data. QA-only password values remain in the fixture/script,
not this report.

`pnpm dev` remains the real MongoDB localhost with its commercial-write gate.
Account creation, applications and public-search POSTs have **not** been enabled
against Atlas. No database/index apply, data migration, administrator reset,
invitation, `.env.local` change, commit, push or deployment occurred.

Hosted public search remains fail-closed until privacy approval, retention and a
monitored native cleanup scheduler are implemented/configured. Its native store
does not trust a stale persisted `cleanupReady` flag. Cloud private storage and
real-database initialization still require separately scoped operator approval.
Member editing/transfers, workbook imports and remaining document/reporting
ports are outside this checkpoint; unsupported routes remain explicit failures.
