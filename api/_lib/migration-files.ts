import { createHash } from 'node:crypto';
import { checkKey, type PrivateObjectStore } from './private-object-store.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';

export type MigrationFile = {
  bucket: string;
  sourceKey: string;
  targetKey: string;
  ownerTable: string;
  sourceOwnerId: string;
  targetOwnerId: string;
  size: number;
  sha256: string;
  contentType: string;
};
type OwnerMapping = { table: string; sourceId: string; targetId: string }[];
type FileSource = (
  bucket: string,
  key: string,
  maxBytes: number,
) => ReturnType<PrivateObjectStore['read']>;
type ExclusiveTarget = Pick<PrivateObjectStore, 'read'> & {
  createIfAbsent(key: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
};
export function planMigrationFiles(
  files: MigrationFile[],
  mapping: { table: string; sourceId: string; targetId: string }[],
  maxBytes: number,
) {
  const issues: { file: number; code: string }[] = [];
  const issue = (file: number, code: string) => issues.push({ file, code });
  const sourceKeys = new Set<string>(),
    targetKeys = new Set<string>();
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    issue(-1, 'INVALID_FILE_LIMIT');
    return { ready: false, issues, manifestDigest: '' };
  }
  for (const [index, file] of files.entries()) {
    try {
      checkKey(file.sourceKey);
      checkKey(file.targetKey);
      if (file.targetKey.endsWith('.metadata')) issue(index, 'INVALID_FILE_MANIFEST');
      if (
        ![
          'afhomes-customer-ids',
          'afhomes-ost-ids',
          'afhomes-payment-receipts',
          'afhomes-service-images',
          'afhomes-profile-photos',
        ].includes(file.bucket) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 1 ||
        file.size > maxBytes ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        typeof file.contentType !== 'string' ||
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(file.contentType) ||
        Object.keys(file).some(
          (key) =>
            ![
              'bucket',
              'sourceKey',
              'targetKey',
              'ownerTable',
              'sourceOwnerId',
              'targetOwnerId',
              'size',
              'sha256',
              'contentType',
            ].includes(key),
        )
      )
        issue(index, 'INVALID_FILE_MANIFEST');
      const owners = mapping.filter(
        (row) => row.table === file.ownerTable && row.sourceId === file.sourceOwnerId,
      );
      if (
        !file.sourceOwnerId ||
        !file.targetOwnerId ||
        owners.length !== 1 ||
        owners[0]!.targetId !== file.targetOwnerId
      )
        issue(index, 'FILE_OWNER_MAPPING_REQUIRED');
      const sourceKey = `${file.bucket}/${file.sourceKey}`;
      if (sourceKeys.has(sourceKey) || targetKeys.has(file.targetKey))
        issue(index, 'DUPLICATE_FILE_MAPPING');
      sourceKeys.add(sourceKey);
      targetKeys.add(file.targetKey);
    } catch {
      issue(index, 'INVALID_FILE_MANIFEST');
    }
  }
  return {
    ready: issues.length === 0,
    issues,
    manifestDigest: issues.length ? '' : purchaseFingerprint({ files, mapping, maxBytes }),
  };
}

function fileMatches(data: Awaited<ReturnType<PrivateObjectStore['read']>>, file: MigrationFile) {
  return (
    !!data &&
    Buffer.isBuffer(data.bytes) &&
    data.bytes.length === file.size &&
    data.contentType === file.contentType &&
    createHash('sha256').update(data.bytes).digest('hex') === file.sha256
  );
}

export async function verifyMigrationFiles(
  files: MigrationFile[],
  mapping: OwnerMapping,
  maxBytes: number,
  source: FileSource,
  target: Pick<PrivateObjectStore, 'read'>,
) {
  const plan = planMigrationFiles(files, mapping, maxBytes);
  if (!plan.ready) return plan;
  const issues: { file: number; code: string }[] = [];
  const issue = (file: number, code: string) => issues.push({ file, code });
  for (const [index, file] of files.entries()) {
    for (const side of ['source', 'target'] as const) {
      try {
        const data =
          side === 'source'
            ? await source(file.bucket, file.sourceKey, maxBytes)
            : await target.read(file.targetKey, maxBytes);
        if (!data) issue(index, `${side.toUpperCase()}_FILE_MISSING`);
        else if (!fileMatches(data, file)) issue(index, `${side.toUpperCase()}_FILE_MISMATCH`);
      } catch {
        issue(index, `${side.toUpperCase()}_FILE_READ_FAILED`);
      }
    }
  }
  return {
    ready: issues.length === 0,
    issues,
    manifestDigest: plan.manifestDigest,
  };
}

/** Unmounted transfer capability; caller approval is bound to the reviewed manifest. */
export async function copyMigrationFiles(
  files: MigrationFile[],
  mapping: OwnerMapping,
  maxBytes: number,
  source: FileSource,
  target: ExclusiveTarget,
  approvedDigest: string,
) {
  const plan = planMigrationFiles(files, mapping, maxBytes);
  const issues = [...plan.issues];
  const receipts: { file: number; status: 'created' | 'reused' }[] = [];
  const result = () => ({
    ready: issues.length === 0,
    issues,
    receipts,
    manifestDigest: plan.manifestDigest,
  });
  if (!plan.ready) return result();
  if (
    !approvedDigest ||
    approvedDigest !== plan.manifestDigest ||
    typeof target.createIfAbsent !== 'function'
  ) {
    issues.push({ file: -1, code: 'APPROVED_EXCLUSIVE_TRANSFER_REQUIRED' });
    return result();
  }
  async function inspect(file: MigrationFile, index: number) {
    try {
      const data = await source(file.bucket, file.sourceKey, maxBytes);
      if (!fileMatches(data, file)) issues.push({ file: index, code: 'SOURCE_FILE_MISMATCH' });
      const existing = await target.read(file.targetKey, maxBytes);
      if (existing && !fileMatches(existing, file))
        issues.push({ file: index, code: 'TARGET_FILE_MISMATCH' });
      return { data, existing };
    } catch {
      issues.push({ file: index, code: 'FILE_READ_FAILED' });
      return null;
    }
  }
  for (const [index, file] of files.entries()) await inspect(file, index);
  if (issues.length) return result();
  for (const [index, file] of files.entries()) {
    const checked = await inspect(file, index);
    if (!checked?.data || issues.length) return result();
    try {
      const created = checked.existing
        ? false
        : await target.createIfAbsent(file.targetKey, checked.data.bytes, file.contentType);
      if (!fileMatches(await target.read(file.targetKey, maxBytes), file)) {
        issues.push({ file: index, code: 'TARGET_FILE_MISMATCH' });
        return result();
      }
      receipts.push({ file: index, status: created ? 'created' : 'reused' });
    } catch {
      issues.push({ file: index, code: 'EXCLUSIVE_FILE_COPY_FAILED' });
      return result();
    }
  }
  const verified = await verifyMigrationFiles(files, mapping, maxBytes, source, target);
  issues.push(...verified.issues);
  return result();
}
