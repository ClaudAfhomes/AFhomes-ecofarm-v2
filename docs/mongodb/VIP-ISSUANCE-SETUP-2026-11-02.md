# Reviewed native VIP-number retirement setup

Read-only plan: `VIP-ISSUANCE-SETUP-PLAN-2026-11-02.json`.

The allocator previously checked only current customer rows. A deleted customer
could therefore lose its number reservation. The prepared allocator also reads
the permanent issuance ledger. New ledger writes stay disabled until this
separately approved initialization completes; localhost startup never seeds it.

Exact approved `afhomes_dev` apply:

- Create `vip_card_number_issuances` and its unique `vip_card_number` index.
- Record the two currently assigned native customer VIP numbers, preserving their
  customer IDs. No existing customer row, number, password, profile or role changes.
- Keep `vip-card-number` at least its reviewed high-water sequence (currently 2).
  The update never decreases an existing counter.
- Set `counters['setup:vip-card-issuances'].seq=1` and record one setup audit event
  using the existing bootstrapped administrator as actor. Do not bootstrap/reset it.

No Supabase records, source tombstones or source credentials are imported by this
setup. No deployment or push is included. Future authorized source migration must
also load source tombstones and run the separate counter high-water planner.

The apply binds to the exact plan digest. Customer/ledger/setup changes between
review and apply abort the data transaction. Index creation is outside the
transaction; if data/audit writes fail, the schema may remain prepared but the
enablement marker and backfill roll back. Inspect/review again before retrying.
Ordinary operations cannot delete this ledger through an application endpoint.

Disposable tests prove read-only planning, protected-owner preservation,
nondecreasing counters, idempotent setup, rollback on audit failure and no reuse
after customer deletion/counter reset. Imports/manual assignments also check
existing reservations. Source-only retired owner IDs remain historical evidence,
not authorization and not a foreign key requiring a surviving customer record.

```powershell
pnpm exec tsx api/scripts/prepare-mongodb-vip-ledger.ts --plan
# Apply only after the exact shared-database authorization:
pnpm exec tsx api/scripts/prepare-mongodb-vip-ledger.ts --apply --approve-vip-ledger=afhomes_dev --approve-plan=<fresh-reviewed-digest>
```

## Applied and verified, 2 November

The owner explicitly approved the safeguard and reviewed setup. The first attempt
created the unique index, then rolled back all data changes: MongoDB driver 7.7
forwards the client timeout twice for insertMany inside withTransaction. A local
regression reproduced that failure with the actual 15-second client timeout.
The setup now uses transactional insertOne calls. All three setup tests and 32
adjacent import-commit tests pass. The refreshed digest changed only because the
already-created index was now present; the authorized data scope stayed identical.

Successful apply: `2026-11-02T12:23:32.842Z`, digest
`b53f84fd5925c698f9732a729a7d2a15c9bce9b685513c8b14e1acf4af13e9ca`.
Read-back: enabled, unique index present, two ledger records, zero missing numbers,
counter minimum 2. One setup audit event was added.

Fresh encrypted capture independently restored 67 collections, 441 documents and
18 private files. Before/after BSON document comparison found changes only in
vip_card_number_issuances, counters and audit_events; existing accounts, credentials,
roles and business records are unchanged. Evidence:
`VIP-ISSUANCE-SETUP-APPLY-2026-11-02.json` and
`VIP-ISSUANCE-SETUP-VERIFICATION-2026-11-02.json`.
Backups remain on this PC with current-Windows-user key recovery, as selected.
No source data import, push or deployment occurred.
