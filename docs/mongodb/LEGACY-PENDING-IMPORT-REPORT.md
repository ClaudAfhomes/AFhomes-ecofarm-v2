# Legacy Pending import compatibility — 29 October 2026

Workspace: `AFhomes-ecofarm-v2`, branch `claud/mongodb-conversion`.
Later checkpoint: non-member Inactive/Cancelled intake now has native proof too.
CREATE preserves the supplied lifecycle status without payments/membership/auth
records. Blank updates preserve stored metadata. INACTIVE updates preserve an
existing non-member customer's status, matching the source's explicit update
branch; CANCELLED updates set cancelled. Financial/member paths were completed
in later reports; see LEGACY-FINANCIAL-IMPORT-REPORT.md. CMS stays last.

## Problem and resulting behavior

The native confirmation guard rejected every non-company workbook, including
ordinary Pending CSV prospects that needed no sale, payment or membership.
Two real MongoDB/HTTP regression tests first reproduced the 501 response.

The job confirmation handler now sends eligible flat Pending rows through a
native guarded transaction. The existing source validator and reference mappings
are reused, with identity/reference queries inside that same MongoDB session.
Source references are `20261204000001_afhomes_customer_ssot_alignment.sql` and
the later company dispatcher/retired-column migrations. No retired OST/IST column
or alternate role model was restored.

- CREATE generates canonical customer IDs and stores the reviewed person/company
  facts. It creates no authentication user, sale, payment, membership or points.
- UPDATE requires the reviewed identity to still match and refuses existing
  membership history. Supplied nonblank metadata/address parts update as in the
  source; blank parts preserve stored values. Existing lifecycle status, account
  ownership and commercial records remain unchanged.
- Import view/update permissions are required before job mutation and rechecked
  for the row transaction. Referral validity, expiry, use limits and active staff
  ownership are rechecked at confirmation. Existing source referral semantics
  are retained; this is not account provisioning or invitation delivery.
- Row writes, generated counters and creation/row audit events are atomic. Exact
  retries do not duplicate customers. A conflicting identity appearing after
  preview requires a new review instead of silently changing CREATE to UPDATE.
- Financial, points, membership and historical VIP declarations stay outside this
  path. The retained guard directs those files to the guided historical workbook;
  it does not downgrade them into prospects or discard their history silently.

The shared internal person/company field lists were extracted for both writers.
The existing optional continuation response remains unchanged for guided imports;
flat results return their customer IDs without fabricating a purchase source or
application. No new collection, index, environment variable or dependency is
required for this change.

## Fresh verification

- **180 tests passed across seven relevant suites**, including real native
  HTTP/MongoDB workflows, shared parsing and existing source-handler reference
  tests. This is not a claim that all 180 are native database tests.
- Actual CSV upload, standard-column XLSX upload and the downloaded CSV template
  were parsed, reviewed, confirmed and queried for persisted customers.
- Blank-field preservation, lifecycle preservation, stale identity rejection,
  concurrent/exact retries, cross-job conflicts, permission denials, audit-failure
  rollback, valid/expired referrals and the financial guard all passed.
- Existing guided/historical import and payment-claim regression suites passed.
- API TypeScript, targeted ESLint and environment isolation passed.

All database writes in these checks used new disposable loopback replicas.
No Atlas business data, existing administrator, environment file, source data or
shared schema was changed. Nothing was committed, pushed or deployed.

## Remaining work

Legacy financial/member CREATE and member lifecycle UPDATE need their own native
port and source-parity proof. Browser UI acceptance is still NOT RUN. One-time
Supabase data migration, password compatibility and database/file recovery remain
separate unfinished work. This Pending compatibility slice does not certify the
whole conversion.
