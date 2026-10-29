import { maskGovernmentId } from '@afhomes/contracts';
import { isoOrNull } from './handler-kit.js';
export const shapeImportJob = (row: Record<string, unknown>) => ({
  id: row.id,
  jobNumber: (row.job_number as string | null | undefined) ?? null,
  sourceType: row.source_type,
  sourceName: row.source_name,
  googleSheetId: row.google_sheet_id ?? null,
  status: row.status,
  totalRows: Number(row.total_rows ?? 0),
  validRows: Number(row.valid_rows ?? 0),
  invalidRows: Number(row.invalid_rows ?? 0),
  insertedRows: Number(row.inserted_rows ?? 0),
  updatedRows: Number(row.updated_rows ?? 0),
  skippedRows: Number(row.skipped_rows ?? 0),
  createdAt: isoOrNull(row.created_at) ?? '',
  validatedAt: isoOrNull(row.validated_at),
  committedAt: isoOrNull(row.committed_at),
  failedAt: isoOrNull(row.failed_at),
  cancelledAt: isoOrNull(row.cancelled_at),
  failedRows: Number(row.failed_rows ?? 0),
});

function maskImportPrivateValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskImportPrivateValues);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        [
          'tin',
          'tin_number',
          'secondary_tin',
          'supplementary_tin_number',
          'tinNumber',
          'supplementaryTinNumber',
          'governmentIdNumber',
          'government_id_number',
        ].includes(key)
          ? typeof item === 'string' && item
            ? maskGovernmentId(item)
            : item
          : maskImportPrivateValues(item),
      ]),
    );
  return value;
}
export const shapeImportRow = (row: Record<string, unknown>) => ({
  id: row.id,
  rowNumber: row.row_number,
  fields: maskImportPrivateValues(row.raw_data ?? {}) as Record<string, string>,
  normalized: maskImportPrivateValues(row.normalized_data ?? {}) as Record<string, unknown>,
  validation: row.validation_status,
  errors: (row.validation_errors ?? []) as { field: string; message: string }[],
  warnings: (row.validation_warnings ?? []) as { field: string; message: string }[],
  action: row.action,
  customerId: row.customer_id ?? null,
  membershipId: row.membership_id ?? null,
});
