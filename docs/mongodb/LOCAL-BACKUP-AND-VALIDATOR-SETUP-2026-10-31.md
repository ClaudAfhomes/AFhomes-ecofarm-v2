# Local encrypted backups and approved validator completion

31 October 2026. User authorized local-computer backup storage and configuring
the missing maintenance access. Browser acceptance remains deferred.

## Completed shared maintenance

The authenticated Atlas CLI identified the configured connection as Cluster0,
a Flex deployment in project `AfHomes MongoDB`. Host matching was performed
privately; the similarly named empty `AFHomes MongoDB` project was not modified.
No connection string or password was printed or committed.

- Created `afhomes_dev_validator_maintenance`, inheriting only `read` on
  `afhomes_dev`, with `COLL_MOD` restricted to card_sales, payments, memberships,
  points_accounts, points_ledger and commissions.
- Created a separate database user restricted to Cluster0, expiring automatically
  on 1 November 2026 at 09:49 Singapore time. Its random credential is only in the
  ignored, Windows-user-restricted `.env.mongodb-maintenance.local`.
- The existing application user/role, administrator identities, passwords and
  assignments were not changed. No network access or cluster tier was changed.
- Fresh preflight matched the exact approved digest
  `0c9e1f503ff99981578b6cfd2ae69eacde65525b9e3a03b7b06ee17f3f231552`.
  Known localhost app listener ports were closed during maintenance.
- Applied only the six previously approved strict/error validators. All six
  read back as matching, with zero invalid records. Post-apply review digest:
  `4df17b6cf06f72c58fa87378117a851625a928bedcba4116289dc33ef4595282`.
- Full-record BSON hashes of those six collections and auth_users, auth_accounts,
  staff_users and staff_role_assignments matched before/after. No business writes,
  index changes, repairs or application-audit inserts were performed by maintenance.
  The separate points-tier proposal was **not applied**.

## Completed local backup setup

Backups: `C:\Users\SSD-CLAUD\.afhomes\backups\afhomes_dev`.
Protected key: `C:\Users\SSD-CLAUD\.afhomes\backup-keys\afhomes_dev.v1.dpapi`.
Directory permissions are restricted to the current Windows user; the 256-bit
archive key is protected with Windows DPAPI CurrentUser, separately from archives.
Archive payloads use AES-256-GCM with authenticated headers and fresh nonces.
No plaintext BSON/file archive or key was written into Git.

The initial pre-maintenance capture stored 66 collections, 437 documents and
18 filesystem files, including private-object metadata sidecars. SHA-256:
`36a046bb977fae6d67249e45231d035bd7d0e2013ceebd32b2aca60098f6136c`.
The stored encrypted archive was reopened and restored on a fresh loopback MongoDB
server without connecting to the source. BSON types, documents, schema/indexes
and private-file bytes are checked. The existing database is never a restore target.
Temporary restore data is removed after verification.

Installed the current-user Windows scheduled task
`AFHomes MongoDB encrypted local backup`, daily at **21:00 local time**.
It runs only while that user is signed in, starts missed runs when possible,
does not overlap runs and retains all archives. Each run captures, reopens the
stored archive and verifies an independent disposable restore. No old backups
are automatically deleted. Failure exits nonzero and records only a sanitized
stage/status in `latest-task.json` inside the private backup directory.

The first scheduled-task run completed successfully with LastTaskResult 0:
66 collections, 437 documents, 18 files; archive SHA-256
`296a46b5d11e4e76a8763bdbe0f0b3c70014639ec8269b4d6d196aa4783d3596`.
This post-maintenance archive includes the newly installed validators.

Manual commands from the repository root:

```powershell
pnpm exec tsx api/scripts/backup-mongodb-local.ts plan
pnpm exec tsx api/scripts/backup-mongodb-local.ts capture
pnpm exec tsx api/scripts/backup-mongodb-local.ts verify <archive-basename.afhb>
Get-ScheduledTaskInfo -TaskName 'AFHomes MongoDB encrypted local backup'
```

The command reads the repository's ignored environment explicitly. `verify`
does not load it or connect to Atlas. It accepts only an archive basename in
the managed backup folder. Restore is limited to an empty, new loopback
`afhomes_restore_*` namespace and an empty scratch directory; existing databases
and files cannot be selected or overwritten. Archive authentication and shape
validation precede restoration. Capture rejects unsupported metadata, symbolic
links, changed repeat-pass snapshots and archives over 64 MiB.

## Limits that remain

- **Same PC only:** drive loss, PC loss, ransomware or loss of this Windows
  profile can destroy both the archives and the ability to decrypt them.
  The DPAPI key is not portable independent key recovery. No off-device copy,
  remote destination, paid service or production recovery guarantee exists.
- Capture uses two matching database snapshot/file passes. It detects observed
  changes but does not enforce a distributed write freeze. A coordinated capture
  window is still needed for live multi-writer/production migration.
- The task needs this Windows user signed in, the repository/runtime intact,
  network access to Atlas and sufficient disk space. Retention remains manual.
- These are MongoDB/native private-file backups. No Supabase rows, password hashes
  or source storage objects were exported or migrated by this work.
- Full business/identity mappings, source-to-target reconciliation, portable key
  recovery, load/caching checks and final browser acceptance remain open.

Primary references: [Atlas custom roles](https://www.mongodb.com/docs/atlas/security-add-mongodb-roles/),
[Flex role propagation](https://www.mongodb.com/docs/atlas/reference/flex-limitations/).
