# Encrypted source capture and disposable staging verification

31 October 2026. The owner explicitly approved capturing source records,
authentication hashes and private files into the existing encrypted local backup
location. Supabase reads only; no Atlas import, account changes, invitations,
deployment, commit or push were authorized by this approval.

## Completed

- Source: AFHomes project `ikaevepedpqygdlipsei`, using the existing ignored
  environment configuration and verified database CA.
- Database reads ran inside repeatable-read, read-only transactions. Both the
  reviewed 93-table set and connection project were checked before capture.
- Captured **93 tables, 595 rows and 10 private files (1,426,555 bytes)**. Two
  complete database/object passes matched before the archive was accepted.
- Original PostgreSQL row JSON is retained as text. Bigint values and
  microsecond timestamps are not parsed into rounded JavaScript numbers during
  capture. Fresh column/constraint/index metadata is included in the archive.
- Authentication uses only the reviewed identity/credential/provider/state
  projection. Source sessions, recovery tokens and MFA secrets are omitted.
- Private objects were downloaded as original bytes using authenticated GETs,
  without transformations, uploads, signed-link creation or source deletion.
  Every declared private object has matching size, MIME, version and SHA-256
  evidence. Public object bytes are outside this private-file capture scope.
- Archive: `supabase-source-20261031025201873-70d38a5e0477432396c3988e253154c3.afsource`
  in `C:\Users\SSD-CLAUD\.afhomes\backups\afhomes_dev`.
  Encrypted size: **3,978,396 bytes**. SHA-256:
  `195e7e5b1014281a2283b702c4d2d5967ed5579b81156b4ed095e6674efd8f92`.
- AES-256-GCM encryption reuses the existing authenticated backup envelope and
  Windows DPAPI CurrentUser-protected key. Only encrypted bytes were persisted
  to the archive; safe aggregate reports contain no records or credential values.
- A separate verify command authenticated the stored archive with **no source
  connection**, loaded every raw row and file into a new disposable loopback
  namespace, and compared them on readback. All 595 rows and 10 files matched.
  The disposable server was stopped and cleaned up. No native authentication or
  business workflow was mounted against that staging data.

Safe machine-readable evidence: SOURCE-CAPTURE-2026-10-31.json and
SOURCE-CAPTURE-VERIFICATION-2026-10-31.json.

## Repeat commands

From the repository root, using the ignored local configuration:

```powershell
pnpm exec tsx api/scripts/capture-migration-source.ts capture
pnpm exec tsx api/scripts/capture-migration-source.ts verify supabase-source-20261031025201873-70d38a5e0477432396c3988e253154c3.afsource
```

Capture writes a new exclusive archive; it never replaces an earlier one. Verify
uses the saved archive and local key only, rejects existing/non-loopback targets,
and cannot import into Atlas. Missing, changed, duplicated or conflicting private
objects prevent a complete archive from being accepted. Versioned/deleted/archive
objects require a separate reviewed inventory and currently fail closed.

## Still required for a native migration

This is **capture and raw staging proof**, not a complete source-to-native
transformation or working business-flow rehearsal. The remaining source/native
mappings, reference-history decisions, identity bindings, native file ownership
metadata, issued-number tombstones and financial/domain reconciliation remain
required. The existing MongoDB administrator was neither copied over nor reset.

The owner identified the three colliding accounts as test accounts. Their source
history remains distinct in the archive/staging namespace; no automatic email
alias, identity merge, native password/profile/role change or deletion was made.
Any eventual import must resolve their explicit disposition before apply.

Two matching passes detect observed changes but do not enforce a distributed
write freeze. Capture currently bounds row text and private bytes to 16 MiB each,
individual files to 10 MiB and the validated source envelope to 32 MiB. Larger
datasets require a reviewed streaming implementation. Same-PC/Windows-profile
loss can still destroy both archive access and key recovery; no off-device copy
or portable recovery key exists yet. Browser acceptance remains deferred.
