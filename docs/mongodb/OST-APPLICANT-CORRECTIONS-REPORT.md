# Native OST applicant corrections

27 October 2026. Workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`. CMS remains last.

## Behavior

The existing `POST /ost-accreditation/members/:id/applicant` endpoint now
implements `update_ost_applicant` from
`supabase/migrations/20261208000006_afhomes_ost_applicant_changes.sql` using
MongoDB transactions. The existing Update Information form and contracts remain
the callers. Direct OST creation remains already accredited; this adds no
registration or invitation journey.

- Preserves both existing authorization checks: accreditation update and member
  update. Effective permissions, account setup and member scope are checked on
  the server and refreshed inside the shared organization transaction lock.
- Uses the strict correction contract. Login email, program/VIP status and other
  protected fields cannot be submitted. Identity-field changes need a reason.
- Verifies a changed address against the existing reference provider and records
  its canonical spelling, postal code and hierarchy codes. Invalid or unavailable
  reference data fails without accepting a correction.
- Appends only changed fields, previous/resulting values, reason, actor and
  ordered sequence to `ost_applicant_changes`. Explicit empty optional fields
  clear their display values. No-change submissions are rejected.
- Uses the existing mutation request fingerprint/replay helper. Concurrent retries
  produce one ledger entry; a conflicting payload for the same request is denied.
  Correction, sequence, audit and replay records commit or roll back together.
  Audit payloads contain the change ID and field names, without applicant values.
- The current-applicant projection overlays the ledger. The member-detail screen
  now reuses that same projection when its existing accreditation-view permission
  allows it, including accounts without an IST network profile.
- Original account, login, password/first-login state, registration, AA identity,
  historical sales and already-submitted renewal snapshots remain intact. Future
  renewal submissions capture the accepted current values.

Implementation changes are limited to the native accreditation handler, its
shared applicant reader, member detail, and focused tests. No dependencies,
environment changes or startup schema writes were added. The real-development
write gate remains unchanged; new tests confirm it blocks this endpoint by
default and permits it only in the explicit core-write mode.

## Proof

PASS: 97 relevant API tests in six suites, including four new real HTTP/cookie
tests against a fresh disposable MongoDB replica set. The new tests exercise
concurrent replay, conflicting request IDs, protected fields, identity reasons,
management/own-account denials, permission restrictions, canonical addresses,
reference outages, explicit clearing, current member-detail reads, frozen renewal
snapshots and audit-failure rollback. They never load Atlas credentials.

PASS: API TypeScript, environment isolation (733 browser and 404 server source
files), and scoped whitespace checks. The new profile assertion was first observed
failing with the original name and missing details, then passed after the shared
reader was connected. The new correction tests first failed with HTTP 501.

PASS: 24 existing OST React tests in `apps/admin/src/features/ost/ost.spec.tsx`.
These cover the existing interface with test services; they are not browser proof
of the native form submission.

Browser acceptance and complete-suite/build reruns are NOT RUN for this checkpoint.
Earlier browser/comprehensive test results do not prove this new form submission.

No existing administrator, Atlas data/indexes, Supabase data or `.env.local` was
changed. Nothing was staged, committed, pushed or deployed.

## Next

Finish the pending browser checks when computer use is available, then continue
workbook/import continuation and claim reconciliation, certified analytics and
reporting, and remaining business acceptance. Preserve existing CMS work and
convert CMS last. Full-platform cutover is not yet established.
