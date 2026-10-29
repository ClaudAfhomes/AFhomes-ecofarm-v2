# Disposable MongoDB recovery rehearsal — 29 October 2026

Run from the repository root:

```sh
pnpm test:mongodb:recovery
```

Verification: **3 recovery tests passed**. The recovery and workbook continuation
files also passed together (**17 tests / 2 files**) after assigning the two-upload
workbook scenario a 30s integration-test budget. The initial nine-file combined
run had 208 passing checks and that one 5s timeout; no assertion failed in it.
API typecheck, targeted ESLint and environment isolation passed.

Later mapping checkpoint: mapping/recovery ran together with **9 passing tests**.
The main source-offline rehearsal now checks BSON/schema/files and native sign-in
against the same fresh runtime-compatible restore. This removes a redundant full
restore that exceeded its 30s deadline under load; no assertions or test deadlines
were weakened. The independent repeated-restore scenario still checks distinct
servers/namespaces and archive tamper rejection.

This command creates synthetic fixtures and fresh loopback replica sets. It never
loads connection credentials, accepts a database URI, reads the existing private
storage folder, or selects an existing restore target. It cannot back up or
overwrite Atlas or the existing `afhomes_dev` server.

## Proof supplied

The rehearsal captures native BSON documents, collection validators/options and
index definitions, plus bytes and metadata from its synthetic private-file store.
Documents retain BSON types, UUID/business-reference strings, exact-decimal money,
historical JSON snapshots, timestamps, role assignments and credential records.
No recursive ID rewriting or account reset occurs.

An AES-256-GCM encrypted archive is written to a temporary local file and read
back. Each collection document and file also has a checksum inside that encrypted
manifest. The source server is stopped before restoring the first test snapshot.
Every restore provisions a fresh server and verifies document/file checksums.
The default namespace is new `afhomes_restore_*`; the explicit runtime rehearsal
uses `afhomes_dev` on another freshly provisioned server to respect the existing
authentication factory's namespace guard. Neither mode can select an existing
server or overwrite an existing target. Repeat restores are independent.

Integration checks cover:

- Native documents, large BSON integers, Decimal128, binary data and dates retain
  their serialized representation after independent restore.
- Synthetic credential records are byte-equivalent. The runtime-compatible
  rehearsal checks the original password and staff identity without weakening
  the authentication namespace guard or changing the first-login password flag.
  Failed assertions do not dump credential records.
- A restored unique index rejects duplicates; a restored validator rejects new
  invalid writes. Trusted archived documents use validation bypass during restore
  so a later validator does not silently discard older stored history.
- Private object bytes and content type remain readable after restoration.
- Modified/truncated archives fail authentication before any target is created.
  Unsupported view metadata fails capture rather than being silently omitted.

## Deliberate limits

This is **synthetic recovery proof**, not an operational or production backup tool.
The encryption key stays in process memory and is erased at cleanup; it is not a
durable key-management solution. Temporary archives and test servers are removed
when the rehearsal ends. Payloads are bounded to 32 MiB. Ordinary collection
options/indexes are supported; views, capped/time-series collections and unknown
options fail closed. No application maintenance mode is implemented here.

The fixture is quiescent. Database records use a snapshot transaction, but schema
metadata and private files are read separately. This does not prove a consistent
backup during concurrent schema/file changes, complete cross-system file-reference
reconciliation, restoration into a running deployment or a measured production
RPO/RTO. Real backup/restore therefore remains an open completion gate.

Before any real-data operation: choose durable owner-controlled encrypted storage
and key recovery, obtain a consistent database/private-files backup, restore it to
an independently approved target, reconcile business/file references and verify
access. The existing owner and source data must remain intact. No real data export
or target restore is authorized by this rehearsal command.

MongoDB's [backup and restore documentation](https://www.mongodb.com/docs/manual/tutorial/backup-and-restore-tools/)
describes its Database Tools; they were unavailable on this machine's PATH. No
tools or dependencies were installed for this rehearsal.
