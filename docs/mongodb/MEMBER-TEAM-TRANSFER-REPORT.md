# Native OST team-transfer checkpoint

27 October 2026. Active workspace `AFhomes-ecofarm-v2`, branch
`claud/mongodb-conversion`. CMS is explicitly deferred until last.

## Delivered

`POST /members/:id/team-transfer` now implements the existing
`transfer_ost_team` behavior from
`supabase/migrations/20261208000011_afhomes_ost_team_transfer.sql` using native
MongoDB transactions. The existing React dialog and request/response schemas
are retained.

- Requires member-update and accreditation-review permissions plus the existing
  reviewer role; current and proposed teams both remain scope-checked.
- Requires an active OST identity with an expired active accreditation term,
  evaluated in Asia/Manila. An in-progress renewal blocks the move.
- Requires a different active Sales Manager with the existing SM -> SSM -> VD
  hierarchy and an unambiguous authoritative current relationship.
- Management confirmation and a trimmed reason remain mandatory.
- Shares the organization lock with renewals, account/role changes and genealogy
  changes. Concurrent retries produce one transfer history row and one audit.
- Reuses request IDs only for the same actor, OST, manager and reason. Conflicting
  payloads are rejected. Audit failure rolls back the relationship, sponsor,
  profile and transfer history together.
- Retires the old relationship and appends its successor. The login, position,
  AA number, accreditation dates, historical sales and sale-time attribution
  snapshots are preserved. This action does not renew accreditation.

The generic referral API previously accepted an OST sponsor change without this
approval. A native regression reproduced HTTP 200 for that bypass; it now returns
403 and directs the operator to the controlled transfer/renewal workflow. Initial
link creation to the OST's already-recorded sponsor remains legal. The older
network test fixture now supplies that required sponsor field.

No additional explicit indexes or Atlas initialization were needed. Transfer
request IDs use the collection's existing MongoDB `_id` uniqueness semantics.
This workflow appends history and exposes no history-update/delete route.

## Verification

- Relevant transfer, genealogy, renewal, account-creation and inherited
  accreditation suites: **42 passed / five files**, exit 0
  (`.mongodb-member-transfer-final.log`).
- Final scope/restriction/localhost-gate follow-up: **53 passed / two files**,
  exit 0 (`.mongodb-transfer-scope-final.log`). This includes seven native
  replica-set transfer cases; most use the real cookie-authenticated HTTP runtime.
  The cross-team projection case injects an authorized reviewer to isolate scope.
- Final API TypeScript passed (`tsc --noEmit`, exit 0), including the
  additional cross-team reviewer and localhost-gate checks.
- Source environment isolation passed: 733 browser and 397 server source files.
  Scoped whitespace checks passed. No frontend source or dependency changed.
- Fresh disposable HTTP runtime also completed application -> reservation ->
  verified payments -> finalized purchase -> activated membership and manual-code
  VIP account activation. New IST and directly accredited OST creation still work.
- Chrome submitted the existing OST team-transfer dialog. After reload, the OST
  retained `AAO24010001` and showed `Synthetic Browser IST` as its new manager.
  Browser console error log was empty. Screenshot:
  `.tmp-bin/mongodb-ost-transfer-proof.jpg` (fictional data only).

All business mutation verification used newly created loopback replica sets.
Existing administrators, real records, `.env.local`, Atlas, remote branches and
hosted deployments were not modified. Nothing was staged, committed or pushed.

## Remaining order

1. Remaining member edits, sales-involvement reads and controlled IST/OST kind
   conversions. These are separate from the now-converted OST team move.
2. Native workbook/import continuation, claim proof/reconciliation and certified
   sales attribution; preserve protected history and exact verified-payment rules.
3. Remaining analytics/report endpoints and browser acceptance of those flows.
4. Outstanding public verification/browser configuration acceptance without
   bypassing privacy, retention or Turnstile gates.
5. CMS last, preserving the current website and the user's existing CMS work.

The full API suite was not rerun in this checkpoint. Full-platform cutover,
production acceptance, data migration and deployment are not claimed.
