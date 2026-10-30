# Durable backup preparation - 30 October 2026

Status: **not operational**. The existing recovery test restores synthetic
encrypted BSON/schema/files to independent disposable servers. Its key is
ephemeral and archives are removed, so it is not a durable real-data backup.
See `RECOVERY-REHEARSAL.md` for exact proof and limits.

For current localhost work, use an owner-controlled encrypted external drive.
Keep the recovery key in a separate password manager and arrange a second copy
away from this PC. A directory on the same PC alone does not protect against
loss of the machine. The owner has not yet provided a destination/path.

For future hosting, a private DigitalOcean Spaces bucket is a suitable candidate
for client-encrypted database/file archives. It is separate from the application
Droplet; access should be scoped to backup operations, with recovery access held
separately. No service, credentials, billing or bucket has been created. Spaces
supports backup storage: [official features](https://docs.digitalocean.com/products/spaces/details/features/).

Atlas-managed backup availability must be checked on the actual cluster before
relying on it. MongoDB documents a gradually available private-preview backup
subscription for Free clusters; this is not evidence that Cluster0 currently has
backups enabled. [Official Free cluster backup documentation](https://www.mongodb.com/docs/atlas/backup/cloud-backup/free-cluster-backup/).

## Required operational proof

- A reviewed source/write-pause arrangement must cover database documents,
  collection options/indexes and referenced private files. Capture should fail
  if versions change; a quiet test fixture does not prove live consistency.
- Encrypt before persistence; never write a plaintext database dump, password
  hash inventory or private object archive to Git or a shared folder. Use a
  private backup destination and separately recoverable encryption key.
- Record encrypted archive checksums, capture time, source scope, software
  compatibility and retention policy. Verify the stored copy, not just the
  in-memory capture. Schedule and monitor backup failures before production use.
- Recover the key independently, stop relying on the source, restore into a new
  approved target and verify documents/BSON types, schema/indexes, original
  credentials, permissions, snapshots, money, points, object links and byte hashes.
- Test tamper rejection and missing/wrong-key behavior. Record measured restore
  time and recovery point; do not claim RPO/RTO from an unmeasured rehearsal.
- Never restore over the existing owner/database or enable a production target
  as a side effect. Real capture/restore needs a concrete reviewed destination,
  consistent capture procedure and exact operator scope.

No real archive, durable key, automated schedule or independent real-data restore
was created in this checkpoint. Backup readiness remains open.
