# Network and private storage continuation

26 October 2026. Working tree: `AFhomes-ecofarm-v2`, `claud/mongodb-conversion`.
This is an incremental local checkpoint. Initial OST registration/provisioning,
full network management and whole-platform MongoDB acceptance remain unfinished.

## Implemented native behavior

### Accreditation and renewal

- `GET /sale-team/:staffId?kind=IST|OST` and `POST /sale-team/:staffId`
  preserve administrator-only access, the existing module grants and MFA/password
  gates. IST identity issuance is date-free and repeatable without renumbering.
  OST approval derives dates from approved current terms, not posted dates.
  Revocation/reapproval preserve the existing AA number. IST revocation remains
  the employee access/deactivation workflow.
- The AA allocator shares a monthly counter across IST/OST prefixes and observes
  current/historical high-water marks. Unique indexes and serialized organization
  transactions prevent duplicate issuance. Audit failure rolls issuance back.
- `GET /ost-accreditation/members/:id` returns scoped, redacted registration,
  current applicant facts, terms and renewal history. Program/VIP state comes
  from persisted ownership and active membership, never applicant claims.
- `GET /ost-accreditation/sponsors` returns qualified active Sales Managers with
  their required active SSM/VD hierarchy and the source's caller scope.
- `POST /ost-accreditation/members/:id/renew`,
  `POST /ost-accreditation/renewals/:id/revise` and
  `POST /ost-accreditation/renewals/:id/decision` implement submission, revision,
  sponsor endorsement, request-changes, rejection and approval.
- Renewals require one calendar year, no overlap with the prior term, the source
  reviewer role/grants, both signatures and current-sponsor endorsement. Referrer
  changes require an expired prior term and a qualified replacement Sales Manager.
- Approval atomically supersedes the old term, inserts one new term, updates AA
  validity, performs any approved sponsor/edge change and writes audits. Concurrent
  approval returns the same term. Errors roll back all linked state. Submission
  request/payload conflicts are refused. Frozen applicant and sale history stay
  unchanged; approved/rejected renewal history cannot be revised by these routes.

Core implementation: `sale-team.mongo.ts`, `ost-accreditation.mongo.ts` and
explicit setup functions called only by disposable fixtures/operator setup.

### OST portal and directory

`ost.mongo.ts` now serves the existing contracts for:

- `GET /ost/me`
- `GET /ost/me/dashboard`
- `GET /ost/me/sales`
- `GET /ost/me/commissions`
- `GET /ost/members` and `GET /ost/members/:id`

Personal routes resolve the signed-in identity, enforce account standing and
return only its own records. Sales/commission lists retain filtering, pagination,
qualifying-sale counts and exact-decimal totals. Settled-before-system commission
rows are excluded. OST commission buckets preserve the source distinction between
earned and paid, rather than copying IST report semantics.

The directory preserves the existing module/self/sponsor scopes. A current Sales
Manager can still read its own retained former OST record; that exception does
not widen its sponsored list. Certified imported-account reporting remains
unavailable until its native attribution implementation is delivered.

### Private objects and profile photos

The user delegated the storage choice. The selected design is **private
S3-compatible object storage, with MongoDB metadata/ownership**. This matches the
conversion plan and is compatible with a future Spaces deployment. No service,
bucket, credentials or paid resource was created.

The official AWS SDK packages `@aws-sdk/client-s3` and
`@aws-sdk/s3-request-presigner` are pinned to `3.1156.0` in the API workspace.
Their declared Node minimum is 20 and license is Apache-2.0. No browser dependency
or custom S3 signature implementation was added.

`private-object-store.ts` supplies private upload/read/delete/existence operations
and bounded signed downloads. Credentials are explicit server configuration;
insecure non-loopback endpoints and incomplete configuration fail closed. Reads
are size-bounded. Ordinary requests never create buckets or apply bucket policies.

`GET|PUT /profile-photo/staff|customer` now preserves the original ownership,
expected-user, password/MFA, upload-rate and JPEG rules. The maximum accepted
compressed JPEG remains 500,000 bytes and 512 pixels per side. The native HTTP
body limit now accommodates that existing photo contract on photo routes only.

Photos use immutable opaque object keys. A MongoDB transaction replaces the
owner's metadata pointer only after upload succeeds and rechecks current access.
Staff photo writes share the organization mutation lock; owner writes also detect
concurrent suspension/access changes. A metadata failure removes the new object
and retains the previous pointer/photo. Successful replacement retires the old
object. Download links expire after five minutes; bytes never enter MongoDB.
Authorized AA reads also include the owner's signed photo URL when available;
missing photos or storage delivery failures preserve the existing null-photo behavior.
The existing JPEG validator was extracted into a pure module and re-exported for
the retained Supabase handler, preserving its tests and behavior.

Failed object cleanup is recorded in `storage_cleanup_jobs`. Immediate cleanup is
implemented; a production background cleanup worker is still required. If both
storage deletion and MongoDB are unavailable, an unreferenced private object can
require operator reconciliation. This limitation does not expose a download link
for an uncommitted upload.

Server-only configuration placeholders were added to `.env.example` and the
source/built environment guard. **`.env.local` was not changed.** Leaving the
provider unset keeps cloud storage disabled. Real private-bucket policy and scoped
credentials require separately authorized operator configuration and acceptance.

Official references:

- [Spaces S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/)
- [AWS signed download behavior and expiry](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [Official SDK presigner](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner)

## Local runtime and evidence

`corepack pnpm dev:mongodb:local` now includes a synthetic OST, the existing
synthetic Sales Manager, a valid hierarchy and an expired historical term. Initial
password changes remain enforced. The fixture is created only on a fresh disposable
loopback replica set, never from `.env.local` or against Atlas.

Its local object adapter is injected explicitly, cannot be selected from `.env`,
and accepts loopback URLs only. Files are outside the Vite workspace in a fresh
temporary directory and are removed on shutdown. Browser child processes receive
no inherited MongoDB/Better Auth/Supabase/AFHomes server variables.

Observed in Chrome using the intended synthetic OST role:

- Login and the existing dashboard, AA/expiry display and renewal navigation.
- Real renewal form submission with calendar-year end-date calculation.
- A persisted `submitted` renewal after full reload; original approved validity
  remained unchanged.
- The new private-photo endpoint removed the former route error. The fresh
  no-photo state rendered with upload enabled. Browser warnings/errors were empty.
- Actual image-byte upload, replacement, expiry and rollback were exercised by
  native HTTP tests; browser file-chooser upload and reviewer approval are not
  claimed as browser-verified.

Ignored evidence: `.tmp-bin/mongodb-ost-renewal-proof.png`. Disposable browser
servers were stopped after verification. The real administrator was never used.

Tests cover real MongoDB/HTTP identity issuance and lifecycle, endorsement,
renewal revision/approval, concurrent replay, sponsor transfer, audit rollback,
historical snapshots, scope denials, private-photo ownership, suspended-customer
denials, signed-link tampering/expiry, 500,000-byte uploads and failed metadata
compensation. The S3 SDK is exercised against a loopback protocol fixture; this
does **not** prove live cloud credentials, signature enforcement or bucket policy.

Verification results:

- Full API suite: **2,865 tests passed across 164 files**. This completed before
  the final AA photo-link fix; it does not independently prove that last fix.
- After that fix: **45 tests passed across four files**, covering native photos,
  accreditation/renewals, the real MongoDB purchase flow and retained photo behavior.
  The new AA photo assertion failed before the fix and passed afterward.
- API TypeScript check passed after the final change. Workspace/operator
  TypeScript, workspace lint, both SPA builds and source/built environment
  isolation checks passed earlier in this checkpoint. Workspace lint retains
  existing warnings (32 admin, nine web); there is no API ESLint script/binary.
- Scoped whitespace checks passed. Browser evidence is limited to the observations
  listed above, not whole-platform acceptance.

## Boundaries and next work

Superseded onboarding recommendation: the user clarified that OST is created
already accredited, without a new registration journey. See
`ACCOUNT-CREATION-SEARCH-REPORT.md` for direct IST/OST creation, native public
search, Customer Lookup verification and the subsequent requested MFA removal.

Real-development access still permits converted reads and existing account
operations only. New accreditation, renewal and photo mutations remain blocked
by `mongo-development-access.ts`. No Atlas writes/indexes/seeds, Supabase data
migration, administrator reset, invitations, cloud configuration, commit, push or
deployment occurred. Redemption and operational Services remain off.

Next implementation work:

1. Initial OST manual/public registration, signature/review/approval and atomic
   temporary-password identity provisioning; use the current SQL and UI contracts.
   Do not mount the old unmounted provisioning experiment or introduce invitations.
2. Complete network-member creation/editing, controlled applicant corrections,
   team transfer/conversion, historical AA resolution and public verification gates.
3. Port ID scans/receipt documents, authorized delivery, review/OCR and required
   media paths onto the selected private-object abstraction.
4. Finish certified imports/recovery/attribution, remaining reports/analytics/CMS,
   settings/jobs and full intended-role browser acceptance.
5. Only after local acceptance, prepare a concrete private-storage and Atlas
   initialization proposal. Do not execute those external actions without approval.
