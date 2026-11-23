import type { MigrationTable } from './migration-mapping.js';
import type { ImportContext } from './customer-import.js';
import type { WorkbookStaffMatch } from './customer-workbook.js';
import { validateCustomerImportFile } from './customer-import-file.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';
import { MAX_IMPORT_ROWS } from './customer-import.js';
import { reviewedImportMigrationTables } from './migration-import-tables.js';
export { reviewedImportMigrationTables } from './migration-import-tables.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const counts = [
  'total_rows',
  'valid_rows',
  'invalid_rows',
  'inserted_rows',
  'updated_rows',
  'skipped_rows',
  'failed_rows',
];

export function migrationImportIssues(table: MigrationTable, row: Record<string, unknown>) {
  const issues: { column: string; code: string }[] = [];
  const fail = (column: string) => {
    if (table.columns.includes(column)) issues.push({ column, code: 'INVALID_IMPORT_HISTORY' });
  };
  if (table.source === 'public.customer_import_jobs' && table.target === 'customer_import_jobs') {
    if (!['excel', 'csv', 'google_sheets'].includes(String(row.source_type))) fail('source_type');
    if (
      ![
        'uploaded',
        'parsing',
        'validated',
        'ready',
        'committing',
        'completed',
        'completed_with_errors',
        'failed',
        'cancelled',
      ].includes(String(row.status))
    )
      fail('status');
    for (const column of counts)
      if (!Number.isSafeInteger(row[column]) || Number(row[column]) < 0) fail(column);
    if (['ready', 'validated'].includes(String(row.status)) && !row.validated_at)
      fail('validated_at');
    if (['completed', 'completed_with_errors'].includes(String(row.status))) {
      if (!row.committed_at) fail('committed_at');
      if (
        row.total_rows !== Number(row.valid_rows) + Number(row.invalid_rows) ||
        row.total_rows !==
          Number(row.inserted_rows) +
            Number(row.updated_rows) +
            Number(row.skipped_rows) +
            Number(row.failed_rows) ||
        row.invalid_rows !== row.failed_rows
      )
        fail('total_rows');
      if (row.status === 'completed' ? row.failed_rows !== 0 : Number(row.failed_rows) <= 0)
        fail('failed_rows');
    }
  }
  if (table.source === 'public.customer_import_rows' && table.target === 'customer_import_rows') {
    if (!Number.isSafeInteger(row.row_number) || Number(row.row_number) < 1) fail('row_number');
    for (const column of ['raw_data', 'normalized_data']) if (!object(row[column])) fail(column);
    for (const column of ['validation_errors', 'validation_warnings'])
      if (!Array.isArray(row[column])) fail(column);
    if (!['valid', 'warning', 'error'].includes(String(row.validation_status)))
      fail('validation_status');
    if (!['CREATE', 'UPDATE', 'SKIP', 'CONFLICT'].includes(String(row.action))) fail('action');
  }
  return issues;
}

/** Rebuild validation from raw fields against current identities; never trust archived normalized authorization. No writes. */
export async function revalidateMigratedImportRows(
  rows: { row_number: number; raw_data: Record<string, string> }[],
  ctx: ImportContext,
  staffMatches: WorkbookStaffMatch[],
  raOwners: Map<string, Set<string>>,
) {
  if (
    rows.length > MAX_IMPORT_ROWS ||
    rows.some(
      (row) =>
        !Number.isSafeInteger(row.row_number) ||
        row.row_number < 1 ||
        !object(row.raw_data) ||
        Object.values(row.raw_data).some((value) => typeof value !== 'string'),
    ) ||
    new Set(rows.map((row) => row.row_number)).size !== rows.length
  )
    throw new Error('Invalid archived import rows');
  // Guided workbooks have separate payment/holder tabs that raw fields cannot reconstruct.
  if (rows.some((row) => row.raw_data.workbook_format === 'company_v2'))
    throw new Error(
      'Revalidate the original guided workbook to preserve its payment and holder sheets',
    );
  const records = rows.map((row) => ({ rowNumber: row.row_number, fields: { ...row.raw_data } }));
  const workbook = records.some((row) => row.fields.workbook_format === 'company_v1');
  if (workbook && records.some((row) => row.fields.workbook_format !== 'company_v1'))
    throw new Error('Mixed archived workbook formats require source review');
  const validated = await validateCustomerImportFile(
    {
      records,
      workbookRecords: workbook ? { rows: records, unknownHeaders: [] } : null,
      workflowRecords: null,
      workflowReview: null,
      reviewMatrix: null,
      sourceHash: purchaseFingerprint(rows),
      sheetId: null,
      unknownHeaders: [],
      sectionedUnknown: [],
      droppedCompanyHeaders: [],
      droppedTemplateColumns: [],
    },
    ctx,
    staffMatches,
    raOwners,
  );
  return {
    validated,
    nativeCommitReady: false as const,
    requiresContinuationReview: true as const,
  };
}

export function reconcileSourceImports(source: Record<string, Record<string, unknown>[]>) {
  const issues: { table: string; code: string }[] = [];
  const jobs = source['public.customer_import_jobs'],
    rows = source['public.customer_import_rows'];
  if (!jobs || !rows)
    return {
      ready: false,
      issues: [{ table: 'public.customer_import_jobs', code: 'MISSING_IMPORT_TABLES' }],
    };
  for (const table of reviewedImportMigrationTables())
    for (const row of source[table.source]!)
      for (const issue of migrationImportIssues(table, row))
        issues.push({ table: table.source, code: issue.code });
  for (const job of jobs) {
    const children = rows.filter((row) => row.import_job_id === job.id);
    if (
      children.length !== job.total_rows ||
      new Set(children.map((row) => row.row_number)).size !== children.length
    )
      issues.push({ table: 'public.customer_import_jobs', code: 'IMPORT_ROW_COUNT_MISMATCH' });
    if (
      ['ready', 'validated'].includes(String(job.status)) &&
      (children.filter((row) => row.validation_status === 'error').length !== job.invalid_rows ||
        children.filter((row) => row.validation_status !== 'error').length !== job.valid_rows)
    )
      issues.push({
        table: 'public.customer_import_jobs',
        code: 'IMPORT_VALIDATION_COUNT_MISMATCH',
      });
  }
  for (const row of rows)
    if (!jobs.some((job) => job.id === row.import_job_id))
      issues.push({ table: 'public.customer_import_rows', code: 'MISSING_IMPORT_JOB' });
  return {
    ready: issues.length === 0,
    issues,
    jobs: jobs.length,
    rows: rows.length,
    requiresNativeRevalidation: true,
  };
}
