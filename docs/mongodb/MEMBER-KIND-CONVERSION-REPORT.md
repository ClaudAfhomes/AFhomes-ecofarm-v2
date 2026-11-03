# Native IST/OST kind conversion checkpoint

27 October 2026. Workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`. CMS remains last.

## Delivered

The existing `POST /members/:id/transfer` route and React dialogs now reach a
native MongoDB transaction for both directions. The authoritative behavior is
`transfer_sale_team_member` in
`supabase/migrations/20261208000014_afhomes_ist_employee_identity_functions.sql`.
The older annual-validity rules for IST were not restored.

- Both directions require `network.members/update`, `organization.staff/update`
  and an Admin/Super Admin principal. Role, hierarchy and lifecycle conditions
  are rechecked in the transaction.
- IST to OST requires an active IST identity, a complete signed official form,
  the same login email, a full active SM -> SSM -> VD sponsor hierarchy, a valid
  annual OST term and no active downlines. Pending applications and conflicting
  current or historical AA identities block conversion. The successor AAO keeps
  the old AAI numeric suffix. Approved form/signature evidence and conversion
  history are recorded; no endorsement is fabricated.
- OST to IST requires an expired active term and no pending renewal. The chosen
  IST position/head must satisfy the existing hierarchy and cycle rules. The
  old OST member becomes inactive and its term is revoked with historical dates
  preserved. A fresh AAI uses the shared allocation rules. New IST validity
  dates are null. A missing sales number is allocated, matching the source role
  trigger; an existing sales number is retained.
- Existing staff UUID, authentication identity, password, forced-password-change
  state and profile photo are preserved. There are no invitations or new MFA
  requirements. Historical sales, commissions and frozen attribution are not
  rewritten.
- The old accreditation is retained in `sale_team_accreditation_history` with
  its successor. Authorized staff AA lookup returns the whitelisted superseded
  identity and authorized private photo. Anonymous historical lookup was not
  opened; the public search privacy/Turnstile gates remain intact.
- Request ID plus canonical payload provides replay protection. A conflicting
  payload is rejected. The shared organization lock serializes competing role,
  hierarchy and renewal changes. Audit failure rolls back business records,
  history and identifier counters together.

Implementation is in `api/_lib/member-kind-transfer.mongo.ts`, registered through
`members.mongo.ts`. It reuses the existing purchase replay/audit helpers,
accreditation allocator, address verifier and MongoDB transaction session.
No dependencies or startup initialization writes were added.

## Verification

- PASS: 76 API tests across member-kind conversion, sale-team/renewal,
  team-transfer, account-creation and development-write-gate suites. Five new
  conversion tests use actual HTTP/cookie authentication and disposable MongoDB
  replica sets. They cover concurrent retries, replay mismatch, same-account
  preservation, historical lookup, signatures, hierarchy/downline/renewal
  denials, collision protection and audit rollback in both directions.
- PASS: 10 existing React tests for the two conversion dialogs.
- PASS: API TypeScript, source/built environment isolation and scoped whitespace
  checks. These results apply to this checkpoint, not a full-platform release.
- PASS: Chrome OST-to-IST submission using a synthetic expired OST. After reload
  it appeared as Sales Manager with successor `AAI26100003`. Screenshot:
  `.tmp-bin/mongodb-kind-transfer-proof.jpg`.
- NOT VERIFIED: IST-to-OST browser submission. Its dialog was opened, but the
  computer-use native pipe/browser connection became unavailable before the
  second acceptance check could finish. Native HTTP integration covers this
  direction; it is not a substitute for the remaining browser check.
- NOT RUN: complete API suite, full-platform browser acceptance and Atlas smoke
  tests. Earlier whole-suite results are historical.

Only synthetic disposable loopback records were mutated for verification.
Existing administrators, `.env.local`, Atlas data/indexes and Supabase data were
not changed. Nothing was staged, committed, pushed or deployed.

## Remaining

Finish IST-to-OST browser acceptance when computer use reconnects. Remaining
official OST correction paths, workbook/import continuation, imported claim
proof/reconciliation, certified analytics/reporting and public browser acceptance
still need separate verification or implementation. Direct OST creation remains
already accredited; this conversion does not add a registration journey.
Preserve existing CMS work and address CMS last. This is not full-platform cutover.
