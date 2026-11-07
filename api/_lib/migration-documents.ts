import type { MigrationRecord, MigrationTable } from './migration-mapping.js';
import {
  bucketForSubject,
  documentObjectPath,
  DOCUMENT_MAX_BYTES,
  type DocumentMime,
} from './documents.js';
import { planMigrationFiles, verifyMigrationFiles, type MigrationFile } from './migration-files.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';
import { reviewedIdentityDocumentMigrationTable } from './migration-document-table.js';
export { reviewedIdentityDocumentMigrationTable } from './migration-document-table.js';

type Row = Record<string, unknown>;
type OwnerMapping = { table: string; sourceId: string; targetId: string }[];
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export function migrationDocumentIssues(table: MigrationTable, row: Row) {
  const issues: { column: string; code: string }[] = [];
  if (table.source !== 'public.identity_documents' || table.target !== 'identity_documents')
    return issues;
  const fail = (column: string) => {
    if (table.columns.includes(column)) issues.push({ column, code: 'INVALID_DOCUMENT_HISTORY' });
  };
  if (!['customer', 'ost_application'].includes(String(row.subject_type))) fail('subject_type');
  if (
    row.subject_type === 'customer'
      ? row.customer_id == null || row.ost_application_id != null
      : row.ost_application_id == null || row.customer_id != null
  )
    fail('subject_type');
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(String(row.mime_type)))
    fail('mime_type');
  const size =
    typeof row.size_bytes === 'string' && /^[1-9][0-9]*$/.test(row.size_bytes)
      ? Number(row.size_bytes)
      : row.size_bytes;
  if (!Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > DOCUMENT_MAX_BYTES)
    fail('size_bytes');
  if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)) fail('sha256');
  if (!['not_requested', 'completed', 'failed', 'unavailable'].includes(String(row.ocr_status)))
    fail('ocr_status');
  if (!['pending_review', 'confirmed', 'rejected'].includes(String(row.verification_status)))
    fail('verification_status');
  return issues;
}

export function reconcileSourceDocumentMetadata(source: Record<string, Row[]>) {
  const table = reviewedIdentityDocumentMigrationTable();
  const rows = source[table.source],
    issues: { row: number; code: string }[] = [];
  if (!rows)
    return { ready: false, issues: [{ row: -1, code: 'DOCUMENT_TABLE_REQUIRED' }], documents: 0 };
  for (const [index, row] of rows.entries()) {
    for (const issue of migrationDocumentIssues(table, row))
      issues.push({ row: index, code: issue.code });
    for (const [column, parent] of Object.entries(table.references!))
      if (row[column] != null && !source[parent]?.some((candidate) => candidate.id === row[column]))
        issues.push({ row: index, code: 'DOCUMENT_SOURCE_REFERENCE_MISSING' });
  }
  return { ready: issues.length === 0, issues, documents: rows.length };
}

/** Private plan only: source ownership and document aliases must be explicitly reviewed. */
export function planMigrationDocumentFiles(
  source: Row[],
  mapped: MigrationRecord[],
  mapping: OwnerMapping,
) {
  const issues: { row: number; code: string }[] = [],
    files: MigrationFile[] = [];
  const targetIds = new Set<string>();
  const alias = (table: string, sourceId: unknown) => {
    const matches = mapping.filter((item) => item.table === table && item.sourceId === sourceId);
    return matches.length === 1 && uuid(matches[0]!.targetId) ? matches[0]!.targetId : null;
  };
  for (const [index, row] of source.entries()) {
    const definition = reviewedIdentityDocumentMigrationTable();
    if (
      definition.columns.some((column) => !Object.hasOwn(row, column)) ||
      definition.notNull!.some((column) => row[column] == null) ||
      migrationDocumentIssues(definition, row).length
    ) {
      issues.push({ row: index, code: 'INVALID_DOCUMENT_HISTORY' });
      continue;
    }
    const id = alias('public.identity_documents', row.id),
      candidate = mapped.filter((item) => item._id === id);
    const type = row.subject_type,
      customer = type === 'customer';
    const ownerTable = customer ? 'public.customers' : 'public.ost_applications';
    const sourceOwnerId = row[customer ? 'customer_id' : 'ost_application_id'];
    const targetOwnerId = alias(ownerTable, sourceOwnerId);
    if (
      !['customer', 'ost_application'].includes(String(type)) ||
      !uuid(row.id) ||
      !uuid(sourceOwnerId) ||
      !targetOwnerId ||
      !id ||
      candidate.length !== 1 ||
      targetIds.has(id)
    ) {
      issues.push({ row: index, code: 'DOCUMENT_OWNER_MAPPING_REQUIRED' });
      continue;
    }
    targetIds.add(id);
    const target = candidate[0]!;
    if (
      target.migration_file_transfer_required !== true ||
      target.subject_type !== type ||
      target[customer ? 'customer_id' : 'ost_application_id'] !== targetOwnerId ||
      target[customer ? 'ost_application_id' : 'customer_id'] != null ||
      target.storage_path !== row.storage_path ||
      [
        'original_filename',
        'mime_type',
        'sha256',
        'extracted_data',
        'reviewed_data',
        'ocr_status',
        'ocr_provider',
        'verification_status',
      ].some(
        (column) =>
          purchaseFingerprint({ value: target[column] }) !==
          purchaseFingerprint({ value: row[column] }),
      ) ||
      Number(row.size_bytes) !== target.size_bytes
    ) {
      issues.push({ row: index, code: 'DOCUMENT_METADATA_MISMATCH' });
      continue;
    }
    const bucket = bucketForSubject(type as 'customer' | 'ost_application');
    if (
      typeof row.storage_path !== 'string' ||
      !row.storage_path.startsWith(bucket + '/') ||
      !['image/jpeg', 'image/png', 'application/pdf'].includes(String(row.mime_type))
    ) {
      issues.push({ row: index, code: 'DOCUMENT_SOURCE_PATH_INVALID' });
      continue;
    }
    files.push({
      bucket,
      sourceKey: row.storage_path.slice(bucket.length + 1),
      targetKey: `${bucket}/${documentObjectPath(type as 'customer' | 'ost_application', targetOwnerId, row.mime_type as DocumentMime, id)}`,
      ownerTable,
      sourceOwnerId,
      targetOwnerId,
      size: Number(row.size_bytes),
      sha256: String(row.sha256),
      contentType: String(row.mime_type),
    });
  }
  if (mapped.length !== source.length || mapped.some((row) => !targetIds.has(row._id)))
    issues.push({ row: -1, code: 'DOCUMENT_MAPPING_INCOMPLETE' });
  const plan = planMigrationFiles(files, mapping, DOCUMENT_MAX_BYTES);
  for (const issue of plan.issues) issues.push({ row: issue.file, code: issue.code });
  return {
    ready: issues.length === 0,
    issues,
    files: issues.length ? [] : files,
    manifestDigest: issues.length
      ? ''
      : purchaseFingerprint({ source, mapped, mapping, fileDigest: plan.manifestDigest }),
  };
}

/** Returns proposed metadata only after both original and copied bytes match. No database or file writes. */
export async function verifyMigrationDocumentLinks(
  source: Row[],
  mapped: MigrationRecord[],
  mapping: OwnerMapping,
  approvedDigest: string,
  readSource: Parameters<typeof verifyMigrationFiles>[3],
  target: Pick<PrivateObjectStore, 'read'>,
) {
  const plan = planMigrationDocumentFiles(source, mapped, mapping);
  if (!plan.ready || !approvedDigest || plan.manifestDigest !== approvedDigest)
    return {
      ready: false,
      issues: plan.issues.length
        ? plan.issues
        : [{ row: -1, code: 'APPROVED_DOCUMENT_PLAN_REQUIRED' }],
      links: [],
    };
  const checked = await verifyMigrationFiles(
    plan.files,
    mapping,
    DOCUMENT_MAX_BYTES,
    readSource,
    target,
  );
  if (!checked.ready)
    return {
      ready: false,
      issues: checked.issues.map((issue) => ({ row: issue.file, code: issue.code })),
      links: [],
    };
  return {
    ready: true,
    issues: [],
    links: plan.files.map((file, index) => {
      const documentId = mapping.find(
        (item) => item.table === 'public.identity_documents' && item.sourceId === source[index]!.id,
      )!.targetId;
      const current = mapped.find((row) => row._id === documentId)!;
      return {
        documentId,
        expectedFingerprint: purchaseFingerprint(current),
        record: {
          ...current,
          migration_source_storage_path: current.storage_path,
          storage_path: file.targetKey,
          upload_state: 'uploaded',
          migration_file_transfer_required: false,
        },
      };
    }),
  };
}
