# Private-file migration preparation - 30 October 2026

2 November transfer continuation: both archived ID files have real source-free
copy/readback/link/replay proof in a new disposable loopback database and temporary
private store. Native historical read DTOs also validate, using a synthetic
reference authorizer rather than a real sign-in. No Atlas/app-storage apply ran.
Document rows remain staged until explicit owner/checksum verification. Unmounted
photo planners preserve the protected owner and existing photos, require exact
identity/business links and copied JPEG readback, and propose no replacement on
identical replay. The source-only full native rehearsal now copies and reads back
all seven archived profile photos into temporary local storage, links their native
metadata and proves an empty metadata replay. No existing app photo or Atlas
metadata was changed. The one unlinked object's ownership remains unresolved and
its bytes stay encrypted and unassigned. See SOURCE-NATIVE-REHEARSAL-2026-11-02.json,
SOURCE-DOCUMENT-REHEARSAL-2026-11-02.json and
MIGRATION-PREPARATION-2026-11-02.md. The older checkpoints below are historical.

2 November source-reference audit: all ten private files remain in the approved
encrypted capture. Two ID scans and seven photos match their original business/
identity references and file-integrity rules. One customer-ID object has no linked
document/payment record and stays unassigned in the archive for review. No native
file or ownership metadata was replaced. See MIGRATION-PREPARATION-2026-11-02.md;
source capture completeness does not imply application file-transfer acceptance.

31 October preparation update: `migration-files.ts` now includes a digest-bound,
exclusive-create local copier with preflight, readback, interruption and replay
proof. It is unmounted and has not read or copied real source files. The review
below still defines the required owner/path/metadata adapters; inventory coverage
and native authorization acceptance remain open. Local encrypted MongoDB/private
file backups are configured separately; see
LOCAL-BACKUP-AND-VALIDATOR-SETUP-2026-10-31.md for the same-PC recovery limitation.

This is a source/native adapter review, not a file transfer. The schema refresh
read metadata only. No private bytes, signed links or object-owner records were
exported. Source row counts and object counts from older reports are not current
proof. Actual transfer and reconciliation remain pending.

| Source | Native representation | Required adapter |
| --- | --- | --- |
| `afhomes-profile-photos/<auth-user-id>/profile.jpg` | `profile_photos`, unique `owner_id`, and `profile-photos/<native-auth-user-id>/<uuid>.jpg` | Resolve the explicit auth identity alias, including protected-owner alias. Validate source JPEG, size and dimensions using existing profile-photo validation. Copy bytes, create native metadata with content type/size, verify readback before linking. |
| `identity_documents.storage_path` | `identity_documents.storage_path`, private object store | Source already stores bucket plus object path. Preserve document UUID, subject, review/OCR history and historical data. Remap only declared customer/application/actor references. Verify actual bytes against `sha256`, `size_bytes`, MIME/signature and document limits. Add native `upload_state=uploaded` only after successful byte verification. Do not replay upload grants or rerun approval/OCR. |
| `payments.receipt_storage_path` | Native payment receipt reference and private object store | Inventory every non-null reference, bind it to its original payment/customer and resolve the actual private bucket/path. Verify bytes and reference compatibility before linking; never treat a database path as a completed file transfer. |
| `storage.objects` | Transfer manifest/provenance, not a copied provider table | Capture source bucket/name/version, explicit native object key, byte count and SHA-256 inside encrypted migration material. Owner IDs are source evidence, not authorization. Reject orphaned, ambiguous or conflicting links. |
| CMS/service images | Deferred disabled-module assets | Preserve the migration plan/history, but do not enable CMS, Services or public delivery during active-module cutover. |

The native profile representation is confirmed in `api/_lib/profile-photo.mongo.ts`;
the source path is defined by `api/_lib/profile-photo.ts`. Native document current
selection in `api/_lib/documents.mongo.ts` requires a persisted path, real SHA-256
and non-rejected verification status. A generic row copy would miss these file
and metadata requirements.

## Transfer and recovery order

1. Obtain a consistent source database/object manifest under a reviewed write
   pause or equivalent snapshot arrangement. Record versions and reject changes
   during capture; independent database and file reads are not an atomic backup.
2. Encrypt the manifest and file bytes before persistent backup storage. Keep the
   recovery key separately and verify it can decrypt an independently read copy.
3. Use a new private staging directory, outside Git and public/static directories.
   Reject path traversal, symlinks, duplicate destinations, unexpected MIME,
   missing objects and checksum/size mismatches. Never overwrite existing native
   object keys or delete source objects during migration.
4. Copy and read back bytes before committing their native references. Record
   explicit receipts so interruption/retry reuses identical verified content and
   blocks conflicting content rather than overwriting it. Database and filesystem
   writes need compensating cleanup; MongoDB transactions cannot encompass files.
5. Restore into a fresh disposable target and reconcile every referenced object:
   counts, bytes, checksums, owner aliases, customer/application/payment links,
   private authorization and short-lived download behavior. Check both missing
   referenced objects and unexplained unreferenced objects.
6. Prove sign-in, document download, public authorized photo delivery and customer
   isolation after restore before presenting an exact real-target migration apply.

Existing upload APIs remain the application path. No new generic storage import
endpoint, source credentials, public bucket or paid service is introduced here.
