import type { SourceArchive } from './migration-source-archive.js';
import type { MigrationRecord } from './migration-mapping.js';
import { migrationTimestamp } from './migration-mapping.js';
import {
  auditStaffIdentityReferences,
  type MigrationIdentitySnapshots,
} from './migration-identity-references.js';
import { decodeProfilePhoto } from './profile-photo-validation.js';
import { PROFILE_PHOTO_MAX_BYTES } from '@afhomes/contracts';
import { planMigrationFiles, verifyMigrationFiles, type MigrationFile } from './migration-files.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';
import { backupChecksum } from './local-mongo-backup.js';

/** Unmounted private plan. Existing photos and the protected owner's profile cannot be replaced. */
export function planMigrationProfilePhotos(
  archive: SourceArchive,
  identities: MigrationIdentitySnapshots,
  owner: { sourceId: string; targetId: string },
  existing: MigrationRecord[],
) {
  const issues: { file: number; code: string }[] = [],
    files: MigrationFile[] = [],
    records: MigrationRecord[] = [];
  const photos = archive.files.filter((file) => file.bucket === 'afhomes-profile-photos');
  const rows = (table: string) =>
    archive.tables
      .find((item) => item.name === table)
      ?.rows.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  const auth = rows('auth.users'),
    staff = rows('public.staff_users'),
    customers = rows('public.customers'),
    objects = rows('storage.objects');
  if (!auth || !staff || !customers || !objects)
    issues.push({ file: -1, code: 'PROFILE_SOURCE_TABLES_REQUIRED' });
  const protectedHeader = auth?.filter((row) => row.id === owner.sourceId);
  if (protectedHeader?.length !== 1)
    issues.push({ file: -1, code: 'PROTECTED_PROFILE_IDENTITY_REQUIRED' });
  else
    issues.push(
      ...auditStaffIdentityReferences(
        [{ id: protectedHeader[0]!.id, email: protectedHeader[0]!.email }],
        owner,
        identities,
      ).map((issue) => ({ file: -1, code: issue.code })),
    );
  const mapping: { table: string; sourceId: string; targetId: string }[] = [];
  let protectedPhotosExcluded = 0, preservedTestAccountPhotos = 0;
  const targetOwners = new Set<string>();
  for (const [index, file] of photos.entries()) {
    const match =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/profile\.jpg$/.exec(
        file.key,
      );
    const sourceId = match?.[1];
    if (!sourceId) {
      issues.push({ file: index, code: 'INVALID_PROFILE_OWNER_PATH' });
      continue;
    }
    if (sourceId === owner.sourceId) {
      protectedPhotosExcluded++;
      continue;
    }
    const header = auth?.filter((row) => row.id === sourceId);
    if (
      header?.length !== 1 ||
      typeof header[0]!.email !== 'string' ||
      (!staff?.some((row) => row.id === sourceId && row.email === header[0]!.email) &&
        !customers?.some((row) => row.auth_user_id === sourceId && row.email === header[0]!.email))
    ) {
      issues.push({ file: index, code: 'PROFILE_BUSINESS_IDENTITY_REQUIRED' });
      continue;
    }
    const identityIssues = auditStaffIdentityReferences(
      [{ id: sourceId, email: header[0]!.email }],
      owner,
      identities,
    );
    if (identityIssues.length) {
      issues.push(...identityIssues.map((issue) => ({ file: index, code: issue.code })));
      continue;
    }
    // Approved test aliases keep their current native profile and photo.
    if (Array.isArray(identities.approvedAliases) && identities.approvedAliases.some((alias) => alias?.sourceId === sourceId)) {
      preservedTestAccountPhotos++;
      continue;
    }
    const targetId = sourceId;
    if (targetId === owner.targetId || targetOwners.has(targetId)) {
      issues.push({ file: index, code: 'PROFILE_OWNER_CONFLICT' });
      continue;
    }
    targetOwners.add(targetId);
    const bytes = decodeProfilePhoto(file.bytes);
    if (
      !bytes ||
      file.contentType !== 'image/jpeg' ||
      bytes.length !== file.size ||
      backupChecksum(bytes) !== file.sha256
    ) {
      issues.push({ file: index, code: 'PROFILE_FILE_INTEGRITY_MISMATCH' });
      continue;
    }
    const metadata = objects?.filter(
      (row) => row.bucket_id === file.bucket && row.name === file.key,
    );
    const updated =
      metadata?.length === 1
        ? migrationTimestamp(metadata[0]!.updated_at, 'preserve-source')
        : { error: 'MISSING_TIMESTAMP' };
    if ('error' in updated) {
      issues.push({ file: index, code: 'PROFILE_SOURCE_METADATA_REQUIRED' });
      continue;
    }
    const targetKey = `profile-photos/${targetId}/migration-${file.sha256}.jpg`;
    const record: MigrationRecord = {
      _id: `migration-photo-${purchaseFingerprint({ targetId, sha256: file.sha256 })}`,
      owner_id: targetId,
      object_key: targetKey,
      content_type: 'image/jpeg',
      size: file.size,
      updated_at: updated.value,
      migration_source_updated_at: metadata![0]!.updated_at,
      migration_source_sha256: file.sha256,
    };
    const previous = existing.filter((row) => row.owner_id === targetId);
    if (
      previous.length > 1 ||
      (previous.length === 1 && purchaseFingerprint(previous[0]) !== purchaseFingerprint(record))
    ) {
      issues.push({ file: index, code: 'EXISTING_PROFILE_PRESERVED' });
      continue;
    }
    mapping.push({ table: 'auth.users', sourceId, targetId });
    files.push({
      bucket: file.bucket,
      sourceKey: file.key,
      targetKey,
      ownerTable: 'auth.users',
      sourceOwnerId: sourceId,
      targetOwnerId: targetId,
      size: file.size,
      sha256: file.sha256,
      contentType: file.contentType,
    });
    if (!previous.length) records.push(record);
  }
  const filePlan = planMigrationFiles(files, mapping, PROFILE_PHOTO_MAX_BYTES);
  issues.push(...filePlan.issues);
  return {
    ready: issues.length === 0,
    issues,
    files: issues.length ? [] : files,
    records: issues.length ? [] : records,
    mapping,
    protectedPhotosExcluded,
    preservedTestAccountPhotos,
    manifestDigest: issues.length
      ? ''
      : purchaseFingerprint({
          filePlan: filePlan.manifestDigest,
          identities,
          owner,
          existing,
          records,
        }),
  };
}

/** Proposed metadata only, after original and target JPEGs both pass byte readback. */
export async function verifyMigrationProfilePhotoLinks(
  archive: SourceArchive,
  identities: MigrationIdentitySnapshots,
  owner: { sourceId: string; targetId: string },
  existing: MigrationRecord[],
  approvedDigest: string,
  target: Pick<PrivateObjectStore, 'read'>,
) {
  const plan = planMigrationProfilePhotos(archive, identities, owner, existing);
  if (!plan.ready || !approvedDigest || approvedDigest !== plan.manifestDigest)
    return {
      ready: false,
      issues: plan.issues.length
        ? plan.issues
        : [{ file: -1, code: 'APPROVED_PROFILE_PLAN_REQUIRED' }],
      records: [],
    };
  const checked = await verifyMigrationFiles(
    plan.files,
    plan.mapping,
    PROFILE_PHOTO_MAX_BYTES,
    async (bucket, key, maxBytes) => {
      const matching = archive.files.filter(
        (file) => file.bucket === bucket && file.key === key && file.size <= maxBytes,
      );
      return matching.length === 1
        ? {
            bytes: Buffer.from(matching[0]!.bytes, 'base64'),
            contentType: matching[0]!.contentType,
          }
        : null;
    },
    target,
  );
  return {
    ready: checked.ready,
    issues: checked.issues,
    records: checked.ready ? plan.records : [],
  };
}
