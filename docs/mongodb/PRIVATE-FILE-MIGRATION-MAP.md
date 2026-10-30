# Private-file migration preparation - 30 October 2026

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
