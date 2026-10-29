# Native imported payment claim reconciliation

27 October 2026. Workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`. CMS remains last.

## Delivered

Replaced the temporary normal-reservation-only claim reader with native claim
review and private receipt handling. The existing React panel and service
contracts remain unchanged. Source behavior comes from
`20261208000016_afhomes_customer_import_continuation.sql`, including the expanded
target-version graph in `20261223000001_afhomes_customer_historical_import.sql`.

Implemented routes under `/customer-imports`:

- `GET sources/:id/claims` and `GET reservations/:id/claims`: actual source-linked,
  paginated and whitelisted claim records, duplicate candidates, proof readiness,
  current linked-payment verification status and opaque review revisions.
- `POST payment-claims/:id/reconcile`: hold, reject, match an existing payment,
  or record a reviewed receipt as an unverified payment.
- `POST payment-claims/:id/proof/upload`: short-lived private byte-upload grant.
- `POST payment-claims/:id/proof/complete`: validate stored receipt bytes and
  bind the uploaded proof to the claim and uploader.
- `GET payment-claims/:id/proof`: short-lived signed private receipt download.
- Internal grant-bound `PUT payment-claims/:id/proof/bytes`: bounded, single-use
  byte transport for the existing upload service. No frontend change is required.

Both Finance payment-verification permission and customer-view permission remain
mandatory. Mutations recheck authority inside a transaction sharing the existing
organization and sales locks. Unknown import/continuation routes remain explicitly
unimplemented; the development gate opens only the converted claim routes when
core writes are explicitly enabled. It still blocks claim writes by default.

## Integrity and privacy

- Review revisions include the claim and current customer, source, applications,
  holders, frozen terms, reservations, payments, claims, memberships, points and
  matched team identities/hierarchy. Changed identity or purchase state requires
  a reload. BSON date values participate in revisions. Original customer identity
  must still match the source row; ambiguity fails closed.
- Existing-payment matching checks the exact customer, executed reservation,
  amount, method and eligible payment status. Recording a potentially duplicate
  payment requires the existing distinct-payment explanation.
- Recording reuses `createMongoPurchaseRecords().record`, including exact money,
  payment numbering, immutable document evidence, audit and request replay. It
  records the original claimed payment date in the note and never changes verified
  totals, activates membership or verifies money automatically.
- Claim decisions, payment/evidence creation, audit and request results commit
  together. Concurrent retries return one payment; conflicting request payloads
  are rejected. Audit failure rolls everything back. Current verified display
  derives from the linked payment without rewriting the original claim status.
- Receipt grants expire after five minutes, bind to the current proof and have
  one-use upload state. Replaced/expired grants fail. Actual size and MIME
  signatures are checked before accepting bytes and again at completion. Claim
  read responses expose no storage keys, grant hashes or arbitrary internal fields.
  Downloads use existing private storage and short-lived signed URLs. Failed
  object cleanup uses the existing cleanup queue.
- Operator-only setup defines the source/link/claim/proof uniqueness indexes.
  It is invoked by disposable fixture setup, not HTTP, health or localhost
  startup. No Atlas index application was performed.

## Verification

PASS: 115 relevant API tests across native claims, native official purchase HTTP
integration, inherited import behavior, continuation helpers and the development
write gate. After tightening method routing, the final native-claim/gate follow-up
passed 65 tests. Eight native claim tests exercise real disposable MongoDB
transactions, cookie authentication and local private files over HTTP.

The tests cover review staleness, customer/team/holder/term/membership/points
changes, permission denials, pagination, explicit scope, duplicate matching,
hold/reject, signed receipt download, invalid/oversized/expired/replaced grants,
concurrent payment recording, request replay/conflict and audit rollback. Initial
native tests failed with the compatibility handler's HTTP 501 before the port.

PASS: three existing React claim-panel tests. These use test services and are not
browser acceptance of the new backend. API TypeScript, environment isolation and
scoped whitespace checks are recorded for this checkpoint.

NOT RUN: browser acceptance, full-suite rerun, build and Atlas smoke tests. All
writes and files used for verification were synthetic and disposable. No existing
administrator, real business record, Atlas index, `.env.local` or Supabase data
was changed. No dependency, commit, push or deployment was made.

## Next

Follow-up: [continuation review/intake](IMPORT-CONTINUATION-REVIEW-REPORT.md) now
implements the ordinary read paths. The write/import limits below still apply.

Workbook parsing/review/commit, purchase-source continuation/recovery, certified
historical import reconciliation and attribution are still unported. This claim
work consumes already-linked import-source records; it does not yet provide a
MongoDB workbook-import screen end to end. Continue those workflows, then
certified analytics/reporting and remaining browser acceptance. CMS stays last.
