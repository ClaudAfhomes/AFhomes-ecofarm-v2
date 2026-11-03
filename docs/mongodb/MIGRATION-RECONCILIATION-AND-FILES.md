# Migration reconciliation and private-file preparation

31 October 2026. Local preparation only, on `claud/mongodb-conversion`.
Browser acceptance is deferred until the preceding preparation is complete.

## Current status - supersedes the earlier checkpoint below

The mapper now has thirty business definitions plus a separate identity planner
and counter high-water planner. See SOURCE-MAPPING-REVIEW.md for current scope,
timestamp evidence and unresolved identity/reference-history decisions.

`copyMigrationFiles` now provides an unmounted, digest-approved local copier:
preflight the complete declared batch, reread before copying, create exclusively,
verify readback, and resume identical copies. Conflicts and interrupted data/
metadata pairs block instead of overwriting or deleting anything. Seven focused
file tests cover real temporary storage, conflicts, interruption and replay.
It requires `createIfAbsent`; the local disk store supports that capability.
Real source bytes were captured only into the approved encrypted archive and
disposable raw staging. Nine of ten files have verified business references;
one remains unlinked. No native application files or ownership metadata were
replaced. See MIGRATION-PREPARATION-2026-11-02.md. Complete native ownership
metadata linking, authorized delivery and financial/domain reconciliation remain
required. A copier does not establish inventory completeness.

The separate maintenance connection is now configured and the six approved core
validators are installed. Local encrypted backups have independent restore proof
and a daily task; the key and archives remain on this PC. Off-device recovery is
not established. See LOCAL-BACKUP-AND-VALIDATOR-SETUP-2026-10-31.md.

## Earlier checkpoint

## Implemented and verified

- `migration-catalog-manifest.ts` adds the complete four-column
  `tier_points_config` definition. PostgreSQL bigint text becomes a native number
  only within the positive safe-integer range. Only BRONZE/SILVER/GOLD are legal;
  `updated_by` follows the declared staff/owner alias. Reuse requires the cap,
  actor and timestamp to agree. No defaults replace source caps.
- This brings the reviewed business components to eleven tables. It does not
  complete the 93-table source inventory or approve a real-data transfer.
- `migration-reconciliation.ts` validates the plan and compares the complete
  target baseline plus planned inserts with an explicit after snapshot. It
  detects changed/missing baseline records, unexpected rows, duplicate IDs,
  missing collections and invalid replay. Full-record fingerprints include
  nested history and the protected owner/assignments. Diagnostics contain
  identifiers/codes, never rejected field values. This is snapshot-level proof;
  it does not replace financial/domain reconciliation or a write freeze.
- `migration-files.ts` is an unmounted **read-only verifier**, not a copier. It
  requires explicit source bucket/key, target key, reviewed owner alias, size,
  content type and SHA-256. Both readers must return matching bytes/metadata.
  Unknown/public buckets, unsafe paths, oversized files, duplicate mappings,
  missing/ambiguous owner aliases and malformed metadata block all reads.
  Missing/changed/unreadable files block verification. Raw read errors, bytes,
  owner IDs and object paths stay out of the result.
- The supported private source buckets are customer IDs, OST IDs, payment
  receipts, service images and profile photos. This does not enable the disabled
  Services module. CMS/public media remain separate.
- A real temporary local private store was populated with labelled synthetic
  bytes by the test fixture. Verification reads those bytes, repeats identically
  and calls neither `put` nor `remove`. No real file was read, exported or copied.

## Separate points-tier hardening proposal

`migration-reference-guards.mongo.ts` proposes a required tier/cap/update-time
schema and a unique tier index. A disposable database proves rejection of zero,
negative, fractional, unsafe, NaN and infinite caps, and duplicate tiers.
The combined migration fixture now checks sixteen unique indexes: fifteen from
existing native setup definitions plus this new proposed tier index.

This is a new proposal, separate from the previously approved six core
validators. Neither runtime startup nor requests install it. No shared apply is
authorized by this report. Existing six-validator authorization is unchanged.
The ignored `.env.mongodb-maintenance.local` remains absent as of this check;
the previously documented maintenance-privilege prerequisite remains unresolved.
Do not broaden the application user's privileges or print connection details.

## Fresh verification

68 tests passed across mapping, identity-reference, password compatibility,
file verification, private-object storage and existing core-validator suites.
The combined fresh disposable load also runs full baseline reconciliation and
empty replay. API typecheck, scoped lint and environment isolation passed.
Full-suite/build/browser acceptance were not rerun for these unmounted adapters.

## Still required before a real migration

1. Finish remaining business/state/reference mappings and timestamp preservation
   policy. Current nonzero microseconds remain blocked, never truncated.
2. Review identity-provider states, bans/deletions, customer links and actual
   bcrypt metadata. The existing administrator/password/assignments stay excluded;
   ID/email matching is not complete authentication acceptance. No invitations,
   account resets, sessions or MFA state are imported.
3. Obtain a complete source object inventory and reviewed metadata/owner/path
   mapping. Verification covers **only declared files**; it cannot prove an
   incomplete manifest covers all source objects. An approved copier, resumable
   transfer receipts, native metadata, cross-owner delivery denial and cleanup
   reconciliation are not implemented by this verifier.
4. Reconcile verified payments, balances, frozen terms, membership/commission
   states, weekday/weekend points, business-number counters and audit history.
5. Complete durable encrypted backups, independent restore/key recovery and
   reviewed maintenance access before any shared schema or import operation.

No Atlas changes, real identity/file export, data transfer, source mutation,
deployment, commit or push occurred in this checkpoint.
