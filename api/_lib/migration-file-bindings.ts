import type { SourceArchive } from './migration-source-archive.js';
import { backupChecksum } from './local-mongo-backup.js';
import { mimeMatchesSignature } from './documents.js';
import { decodeProfilePhoto } from './profile-photo-validation.js';

/** Inventory original business links only; no owner alias, metadata write or file copy. */
export function reviewSourceFileBindings(archive: SourceArchive) {
  const issues: { table: string; row: number; code: string }[] = [];
  const issue = (table: string, row: number, code: string) => issues.push({ table, row, code });
  const rows = (name: string) => {
    const table = archive.tables.find((candidate) => candidate.name === name);
    if (!table) {
      issue(name, -1, 'SOURCE_TABLE_REQUIRED');
      return [];
    }
    return table.rows.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  };
  const identities = new Set(rows('auth.users').map((row) => row.id));
  const customers = new Set(rows('public.customers').map((row) => row.id));
  const ostApplications = new Set(rows('public.ost_applications').map((row) => row.id));
  const files = new Map(
    archive.files.map((file, index) => [`${file.bucket}/${file.key}`, { file, index }]),
  );
  const bound = new Map<number, string>();
  let documents = 0,
    profilePhotos = 0,
    receipts = 0,
    deferredDisabled = 0;
  const bind = (index: number, owner: string, table: string, row: number) => {
    if (bound.has(index) && bound.get(index) !== owner)
      issue(table, row, 'CROSS_OWNER_FILE_REFERENCE');
    else bound.set(index, owner);
  };
  rows('public.identity_documents').forEach((row, index) => {
    const object = files.get(String(row.storage_path));
    const customer = row.subject_type === 'customer';
    const subject = customer ? row.customer_id : row.ost_application_id;
    if (
      !['customer', 'ost_application'].includes(String(row.subject_type)) ||
      !(customer ? customers : ostApplications).has(subject)
    )
      issue('public.identity_documents', index, 'DOCUMENT_SUBJECT_REFERENCE_MISSING');
    if (!object) {
      issue('public.identity_documents', index, 'DOCUMENT_OBJECT_MISSING');
      return;
    }
    const { file } = object,
      bytes = Buffer.from(file.bytes, 'base64');
    if (
      file.bucket !== (customer ? 'afhomes-customer-ids' : 'afhomes-ost-ids') ||
      !Number.isSafeInteger(row.size_bytes) ||
      row.size_bytes !== file.size ||
      row.sha256 !== file.sha256 ||
      row.mime_type !== file.contentType ||
      !mimeMatchesSignature(file.contentType, bytes)
    )
      issue('public.identity_documents', index, 'DOCUMENT_FILE_INTEGRITY_MISMATCH');
    bind(
      object.index,
      `${row.subject_type}:${String(subject)}`,
      'public.identity_documents',
      index,
    );
    documents++;
  });
  rows('public.payments').forEach((row, index) => {
    if (row.receipt_storage_path === null) return;
    const object = files.get(String(row.receipt_storage_path));
    if (
      !object ||
      object.file.bucket !== 'afhomes-payment-receipts' ||
      !mimeMatchesSignature(object.file.contentType, Buffer.from(object.file.bytes, 'base64'))
    ) {
      issue('public.payments', index, 'RECEIPT_OBJECT_MISSING_OR_INVALID');
      return;
    }
    bind(object.index, `payment:${String(row.id)}`, 'public.payments', index);
    receipts++;
  });
  archive.files.forEach((file, index) => {
    const bytes = Buffer.from(file.bytes, 'base64');
    if (
      bytes.length !== file.size ||
      bytes.toString('base64') !== file.bytes ||
      backupChecksum(bytes) !== file.sha256
    )
      issue('storage.objects', index, 'ARCHIVE_FILE_HASH_MISMATCH');
    if (file.bucket === 'afhomes-profile-photos') {
      const match =
        /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/profile\.jpg$/.exec(
          file.key,
        );
      if (
        !match ||
        !identities.has(match[1]) ||
        file.contentType !== 'image/jpeg' ||
        !decodeProfilePhoto(file.bytes)
      )
        issue('storage.objects', index, 'PROFILE_OWNER_OR_JPEG_INVALID');
      else {
        bind(index, `identity:${match[1]}`, 'storage.objects', index);
        profilePhotos++;
      }
    }
    if (file.bucket === 'afhomes-service-images') {
      deferredDisabled++;
      return;
    }
    if (!bound.has(index))
      issue('storage.objects', index, 'UNLINKED_SOURCE_OBJECT_REQUIRES_REVIEW');
  });
  return {
    ready: issues.length === 0,
    issues,
    files: archive.files.length,
    boundFiles: bound.size,
    documents,
    profilePhotos,
    receipts,
    deferredDisabled,
    unlinkedReferences: archive.files.flatMap((file, index) =>
      bound.has(index) || file.bucket === 'afhomes-service-images'
        ? []
        : [
            {
              file: index,
              bucket: file.bucket,
              referenceTables: archive.tables
                .filter(
                  (table) =>
                    !table.name.startsWith('storage.') &&
                    table.rows.some((raw) => raw.includes(file.key)),
                )
                .map((table) => table.name),
            },
          ],
    ),
    nativeMetadataLinked: false,
  };
}
