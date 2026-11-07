# Externally verified customer history import

Status: implemented and tested locally; migration 19 applied to the shared database on 2026-10-20. Matching Preview release is in progress.

The previous company importer persisted prospect identities and payment claims. Confirmation did not create the application, reservation or verified ledger history, so every imported customer still required application work. The new opt-in import mode accepts company history already verified outside the system, after an authorized importer reviews the preview and confirms it.

## Resulting behavior

| Workbook status and reconciled payment history | Records and destination |
| --- | --- |
| Pending, no payments | Actual draft application in Customer Applications |
| Reservation Paid, payments equal the included reservation fee | Approved application, submitted agreement and verified payment history in IST Reservations |
| Down Payment or Partially Paid, positive payment total below the contract total | Approved application, executed agreement and verified ledger history; Finance shows the exact outstanding balance |
| Fully Paid, payments equal the contract total | Executed agreement and finalized, payment-verified sale; fully paid/activation queue, linked customer and payment history |

All three tiers use this routing. Gold can retain a supplementary holder. Confirmation records the importer, acceptance time, reason, source hash and totals in a private immutable receipt. It does not assert that signatures, consent or identity documents were collected by this system. Normal application writes still require an actual acknowledgment date; the database defers that check only for an application backed by an external acceptance receipt.

Matching existing agreements and verified payments are reused when their customer, seller, frozen terms, original dates and references agree. Conflicting, ambiguous, held or rejected history is refused; protected records are not overwritten. Same-row retries and a new-job reimport reuse the same application, reservation, payment and sale IDs. Source changes after preview abort atomically.

Historical sales retain `legacy_import` provenance. They do not acquire today's genealogy snapshots as historical evidence. Recorded import/application participants remain visible through the existing IST/OST involvement projection. A preexisting LF-only legacy trigger installer missed CRLF function bodies; this migration installs its intended historical-import exclusion without changing existing snapshot rows. Normal sale finalization retains the previous canonical implementation.

Outstanding imported balances continue through the existing payment recording, verification and finalization workflow. The continuation panel reads current ledger totals after later collection, while the acceptance receipt retains the original import totals.

## Verification

- `node --import tsx packages/db-testing/scripts/test-external-customer-import.mjs`: real disposable loopback PostgreSQL, all repository migrations, 15 tier/status combinations. Checks exact ledger totals, module destinations, Gold secondary holder, same-tree OSTs with different direct uplines, IST/OST involvement, retries, cross-job reimports, existing reservation/payment reuse, preserved payment contents, failed-source atomicity, immutable receipts and permission denial. Also tests collection of an imported partial balance through finalization, normal sale finalization, and the normal acknowledgment requirement.
- Targeted API suite: 98 tests passed across external routing, customer imports, continuation and official-form transitions.
- Focused import UI suite: 15 tests passed, including opt-in acceptance, retained mode in upload, correct destination/balance text and unchanged claim-only wording for ordinary imports. Existing broader official-form/import UI regression set also passed.
- API, admin and web typechecks passed; admin build passed.
- Changed UI lint: zero errors, one existing Fast Refresh warning in the application editor. Build retains the existing large-bundle warning.
- Schema index regenerated from authoritative migrations. No dependencies added.

## Release boundary and remaining limits

Apply only `20261208000019_afhomes_customer_external_verified_import.sql`, after fresh shared-project identity/history preflight, then release matching code to `origin/claud/develop` Preview. The migration does not backfill or promote existing imported rows. Re-preview and explicitly reconcile those imports using the verified-history mode. Do not replay the known history-missing older migrations.

Migration 19 committed at `2026-10-20T11:52:31.679Z`, SHA-256 `e64eee7c973bc506b12d7e24b5aaaf5fab6be2a2a978881b9512ef0c6d11f0d0`. History increased from 112 to 113 entries. All 117 preexisting table counts and all 12 protected business-table digests were unchanged. Independent post-commit verification confirmed the recorded file body, private receipt RLS/ACLs, two service-only public entrypoints, no private helper execute leaks, and the exact preserved normal finalizer predecessor. No customers, payments, reservations, memberships or historical rows were created or modified by the migration.

Preview deployment and authenticated browser acceptance of this new mode remain unverified at this handoff update.

The current guided workbook has no authoritative membership activation/expiry or suspension dates. Active VIP, expired, suspended, cancelled and inactive membership histories therefore remain validation holds in verified mode; this release does not invent membership dates, create portal accounts, award points or silently activate memberships. Fully paid is a financial state; membership activation remains separate. Existing applications with no matching approved reservation require explicit reconciliation rather than replacement.
