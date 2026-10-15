import { customerDirectory } from '../_lib/customer-directory.js';
import { z } from 'zod';
import {
  CUSTOMER_EXPORT_COLUMNS,
  CUSTOMER_CATEGORY_LABELS,
  customerCategorySchema,
  customerImportCommitResponseSchema,
  customerImportJobSchema,
  customerImportParseResponseSchema,
  maskGovernmentId,
  type CustomerExportRow,
} from '@afhomes/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  customerExportCsv,
  customerExportXlsx,
  fetchGoogleSheetCsv,
  isCompanyMembershipTemplate,
  isInterimV2Flat,
  isLegacyCompanyMembershipTemplate,
  isV2MembershipTemplate,
  looksLikeSectionBandRow,
  matrixToRecords,
  membershipTemplateV2Csv,
  membershipTemplateV2SectionedXlsx,
  mergeSectionedTemplateSheets,
  mergeV2SectionedTemplateSheets,
  parseCsvMatrix,
  parseXlsxMatrix,
  parseXlsxSheets,
  remapCompanyTemplateMatrix,
  remapV2TemplateMatrix,
  workbookLooksInterimV2,
  workbookLooksV2,
  validateImportRow,
  type ImportContext,
  type ValidatedImportRow,
} from '../_lib/customer-import.js';
import {
  COMPANY_IMPORT_EXTRA_COLUMNS,
  LEGACY_MEMBERSHIP_TEMPLATE_POSITION_MAP,
} from '@afhomes/contracts';
import {
  audit,
  deny,
  fail,
  isoOrNull,
  jsonBody,
  mapRpcError,
  method,
  route,
  subPath,
  type Db,
} from '../_lib/handler-kit.js';
import { hashIdentifier } from '../_lib/identifier.js';
import { serviceClient } from '../_lib/rest.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const MODULE = 'governance.customer_import';

const parseSchema = z.object({
  source: z.enum(['excel', 'csv', 'google_sheets']),
  contentBase64: z
    .string()
    .max(MAX_IMPORT_BYTES * 2)
    .optional(),
  sheetUrl: z.string().trim().max(500).optional(),
  sourceName: z.string().trim().min(1).max(200).optional(),
});

const exportQuerySchema = z.object({
  category: z.string().trim().max(40).optional(),
  tier: z.enum(['BRONZE', 'SILVER', 'GOLD']).optional(),
  seller: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(5000),
});

const sendFile = (res: VercelResponse, filename: string, mime: string, bytes: Uint8Array) =>
  res.status(200).json({ filename, mime, content: Buffer.from(bytes).toString('base64') });

const shapeJob = (row: Record<string, unknown>) => ({
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

const shapeRow = (row: Record<string, unknown>) => ({
  id: row.id,
  rowNumber: row.row_number,
  fields: (row.raw_data ?? {}) as Record<string, string>,
  normalized: (row.normalized_data ?? {}) as Record<string, unknown>,
  validation: row.validation_status,
  errors: (row.validation_errors ?? []) as { field: string; message: string }[],
  warnings: (row.validation_warnings ?? []) as { field: string; message: string }[],
  action: row.action,
  customerId: row.customer_id ?? null,
  membershipId: row.membership_id ?? null,
});

async function buildContext(
  db: Db,
  records: { fields: Record<string, string> }[],
): Promise<ImportContext> {
  const emails = [
    ...new Set(records.map((r) => (r.fields.email ?? '').trim().toLowerCase()).filter(Boolean)),
  ];
  const numbers = [
    ...new Set(records.map((r) => (r.fields.customer_number ?? '').trim()).filter(Boolean)),
  ];
  const memberNos = [
    ...new Set(records.map((r) => (r.fields.membership_number ?? '').trim()).filter(Boolean)),
  ];
  const { data: planRows, error: planError } = await db
    .from('card_plans')
    .select('id,code')
    .eq('is_active', true);
  if (planError) throw planError;
  const plans = (planRows ?? []) as { id: string; code: string }[];
  const customerByEmail = new Map<string, { id: string }>();
  const customerByNumber = new Map<string, { id: string; email: string }>();
  if (emails.length > 0) {
    const { data, error } = await db.rpc('match_import_emails', { p_emails: emails });
    if (error) throw error;
    // Email match is case-insensitive at the DB unique index; compare lowered.
    for (const row of (data ?? []) as { id: string; email: string }[])
      customerByEmail.set(String(row.email).toLowerCase(), { id: String(row.id) });
  }
  if (numbers.length > 0) {
    const { data, error } = await db
      .from('customers')
      .select('id,email,customer_number')
      .in('customer_number', numbers);
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; email: string; customer_number: string }[])
      customerByNumber.set(String(row.customer_number), {
        id: String(row.id),
        email: String(row.email),
      });
  }
  const membershipByNumber = new Map<string, { id: string; customerId: string }>();
  if (memberNos.length > 0) {
    const { data, error } = await db
      .from('memberships')
      .select('id,customer_id,membership_number')
      .in('membership_number', memberNos);
    if (error) throw error;
    for (const row of (data ?? []) as {
      id: string;
      customer_id: string;
      membership_number: string;
    }[])
      membershipByNumber.set(String(row.membership_number), {
        id: String(row.id),
        customerId: String(row.customer_id),
      });
  }
  // Referral codes are stored hashed; resolve the same way OST registration does.
  const codes = [
    ...new Set(
      records
        .flatMap((r) => [r.fields.referral_code ?? '', r.fields.seller_code ?? ''])
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const referralStaffByCode = new Map<string, string>();
  if (codes.length > 0) {
    const hashes = codes.map((c) => hashIdentifier(c));
    const { data, error } = await db
      .from('referral_codes')
      .select('code_hash,sponsor_staff_id')
      .in('code_hash', hashes);
    if (error) throw error;
    const byHash = new Map(
      ((data ?? []) as { code_hash: string; sponsor_staff_id: string }[]).map(
        (r: { code_hash: string; sponsor_staff_id: string }) =>
          [r.code_hash, r.sponsor_staff_id] as const,
      ),
    );
    codes.forEach((code, i) => {
      const sponsor = byHash.get(hashes[i]!);
      if (sponsor) referralStaffByCode.set(code, String(sponsor));
    });
  }
  return {
    plansByTier: new Map(
      plans.map((p) => [
        String(p.code).toUpperCase(),
        { id: String(p.id), code: String(p.code).toUpperCase() },
      ]),
    ),
    customerByNumber,
    customerByEmail,
    membershipByNumber,
    referralStaffByCode,
    seenMembershipNumbers: new Map(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const db = serviceClient() as Db;
  if (!db) return fail(res, 'INTERNAL', 'Supabase server configuration is incomplete', 500);
  try {
    const path = subPath(req);

    if (method(req) === 'GET' && path === 'template/xlsx') {
      const auth = await authorizeAfHomes(req, MODULE);
      if ('error' in auth) return deny(res, auth);
      return sendFile(
        res,
        'membership-template.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        membershipTemplateV2SectionedXlsx(),
      );
    }
    if (method(req) === 'GET' && path === 'template/csv') {
      const auth = await authorizeAfHomes(req, MODULE);
      if ('error' in auth) return deny(res, auth);
      return sendFile(
        res,
        'membership-template.csv',
        'text/csv',
        new TextEncoder().encode(membershipTemplateV2Csv()),
      );
    }

    if (method(req) === 'POST' && path === 'parse') {
      const auth = await authorizeAfHomes(req, MODULE, 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = parseSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid import request', 400);
      const { source, sourceName } = parsed.data;
      let matrix: string[][];
      let sheetId: string | null = null;
      // Sectioned-template extras surface as per-row warnings below, next to
      // the established unknown-column and dropped-header warnings.
      let sectionedUnknown: string[] = [];
      // Guided-template part columns (names, the supplementary address) are
      // joined per row and overlaid onto the parsed fields after parsing.
      let v2Joins: { rowNumber: number; values: Record<string, string> }[] = [];
      try {
        if (source === 'google_sheets') {
          if (!parsed.data.sheetUrl)
            return fail(res, 'VALIDATION_ERROR', 'A Google Sheets URL is required', 400);
          const csv = await fetchGoogleSheetCsv(parsed.data.sheetUrl);
          const { parseGoogleSheetUrl: parseUrl } = await import('@afhomes/contracts');
          sheetId = parseUrl(parsed.data.sheetUrl)?.spreadsheetId ?? null;
          matrix = parseCsvMatrix(csv);
        } else {
          if (!parsed.data.contentBase64)
            return fail(res, 'VALIDATION_ERROR', 'File content is required', 400);
          const bytes = new Uint8Array(Buffer.from(parsed.data.contentBase64, 'base64'));
          if (bytes.length === 0 || bytes.length > MAX_IMPORT_BYTES)
            return fail(res, 'VALIDATION_ERROR', 'File is empty or exceeds the size limit', 400);
          if (source === 'excel') {
            // A workbook whose non-guide tabs carry the guided vocabulary
            // merges as the guided template (the current download); anything
            // else tries the legacy sectioned merge. A multi-sheet file that
            // matches neither stays rejected rather than silently reading
            // the wrong tab.
            const sheets = parseXlsxSheets(bytes);
            if (sheets.length === 1) {
              matrix = sheets[0]!.matrix;
            } else {
              // A workbook filled from the superseded interim guided layout
              // gets a pointed fix message instead of drowning in
              // unknown-column warnings from the legacy merge.
              if (workbookLooksInterimV2(sheets))
                return fail(
                  res,
                  'VALIDATION_ERROR',
                  'This workbook was filled from an older template. Download the new template and copy the rows over.',
                  400,
                );
              const looksV2 = workbookLooksV2(sheets);
              try {
                if (looksV2) {
                  matrix = mergeV2SectionedTemplateSheets(sheets).matrix;
                } else {
                  const merged = mergeSectionedTemplateSheets(sheets);
                  matrix = merged.matrix;
                  sectionedUnknown = merged.unknownHeaders;
                }
              } catch (error) {
                // Surface the merge's own reason (missing tab, row-count
                // mismatch, foreign workbook): it names the exact tab and
                // fix, while the generic single-worksheet hint never did.
                return fail(
                  res,
                  'VALIDATION_ERROR',
                  error instanceof Error
                    ? error.message.slice(0, 300)
                    : 'Import requires exactly one worksheet; for guided entry use the sectioned membership template (README + Primary/Supplementary/Related/Package)',
                  400,
                );
              }
            }
          } else {
            matrix = parseCsvMatrix(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            // The CSV download carries a section band row above the headers
            // so the columns read as groups; strip it here so a
            // saved-and-refilled template parses exactly like a plain header
            // file. A file without the band row (deleted, or an older
            // template) is unchanged.
            if (looksLikeSectionBandRow(matrix[0] ?? [])) matrix = matrix.slice(1);
          }
        }
      } catch (error) {
        return fail(
          res,
          'VALIDATION_ERROR',
          error instanceof Error ? error.message.slice(0, 200) : 'Unparseable file',
          400,
        );
      }
      let records: { rowNumber: number; fields: Record<string, string> }[];
      let unknownHeaders: string[];
      // A flat file (CSV or single-sheet XLSX) filled from the superseded
      // interim guided layout gets the pointed fix message before any remap.
      if (isInterimV2Flat(matrix[0] ?? []))
        return fail(
          res,
          'VALIDATION_ERROR',
          'This file was filled from an older template. Download the new template and refill it.',
          400,
        );
      // Positional remaps onto import columns: the guided layout first, then
      // the 44-column company template. Anything else keeps the established
      // name-based behavior. Dropped reference columns are reported below.
      let droppedCompanyHeaders: { index: number; header: string }[] = [];
      let droppedTemplateColumns: { index: number; header: string }[] = [];
      let templated = false;
      try {
        if (isV2MembershipTemplate(matrix[0] ?? [])) {
          const remapped = remapV2TemplateMatrix(matrix);
          matrix = remapped.matrix;
          droppedTemplateColumns = remapped.dropped;
          v2Joins = remapped.joins;
          templated = true;
        } else if (isCompanyMembershipTemplate(matrix[0] ?? [])) {
          const remapped = remapCompanyTemplateMatrix(matrix);
          matrix = remapped.matrix;
          droppedCompanyHeaders = remapped.dropped;
          templated = true;
        } else if (isLegacyCompanyMembershipTemplate(matrix[0] ?? [])) {
          // Superseded 45-column download (OST/IST NAME still at position
          // 28): remap through the legacy positions so its values still land
          // on the existing customer-record pipeline instead of failing as
          // 45 unknown headers. Fresh downloads no longer carry the column.
          const remapped = remapCompanyTemplateMatrix(
            matrix,
            LEGACY_MEMBERSHIP_TEMPLATE_POSITION_MAP,
          );
          matrix = remapped.matrix;
          droppedCompanyHeaders = remapped.dropped;
          templated = true;
        }
        const converted = matrixToRecords(
          matrix,
          // Remapped template keys live outside the established template
          // columns; every other file keeps strict known headers.
          templated ? [...COMPANY_IMPORT_EXTRA_COLUMNS] : [],
        );
        records = converted.rows;
        unknownHeaders = converted.unknownHeaders.filter(
          (h) => !h.startsWith('__company_ignored_'),
        );
        // Part columns land on their join key (never derived from FULL
        // NAME); blank parts leave the field alone. Keyed by row number so
        // dropped all-blank rows cannot shift the alignment.
        if (v2Joins.length > 0) {
          const byRow = new Map(v2Joins.map((join) => [join.rowNumber, join.values]));
          for (const record of converted.rows) {
            const values = byRow.get(record.rowNumber);
            if (!values) continue;
            for (const [key, value] of Object.entries(values))
              if (value.trim() !== '') record.fields[key] = value;
          }
        }
      } catch (error) {
        return fail(
          res,
          'VALIDATION_ERROR',
          error instanceof Error ? error.message : 'Empty spreadsheet',
          400,
        );
      }
      if (records.length > MAX_IMPORT_ROWS)
        return fail(
          res,
          'VALIDATION_ERROR',
          `Import exceeds the ${MAX_IMPORT_ROWS}-row limit`,
          400,
        );
      // Export-shape alias: a re-imported export carries derived_category
      // instead of source_status. Unknown columns otherwise only warn.
      for (const record of records) {
        if (!record.fields.source_status && record.fields.derived_category)
          record.fields.source_status = record.fields.derived_category;
      }
      const ctx = await buildContext(db, records);
      const today = new Date().toISOString().slice(0, 10);
      const validated: ValidatedImportRow[] = records.map((r) => {
        const v = validateImportRow(r.rowNumber, r.fields, ctx, today);
        for (const h of unknownHeaders)
          v.warnings.push({ field: h, message: 'Unknown column: ignored' });
        for (const h of sectionedUnknown)
          v.warnings.push({ field: h, message: 'Unknown column: ignored' });
        for (const dropped of droppedCompanyHeaders)
          v.warnings.push({
            field: dropped.header || `column ${dropped.index + 1}`,
            message: 'Company template column has no v2 import target and was ignored',
          });
        for (const dropped of droppedTemplateColumns)
          v.warnings.push({
            field: dropped.header || `column ${dropped.index + 1}`,
            message: 'Reference-only column was ignored',
          });
        if (v.errors.length === 0 && v.warnings.length > 0) v.validation = 'warning';
        return v;
      });
      const validRows = validated.filter((v) => v.errors.length === 0).length;
      const invalidRows = validated.length - validRows;
      const status = invalidRows === 0 ? 'ready' : 'validated';
      const now = new Date().toISOString();
      const { data: job, error: jobError } = await db
        .from('customer_import_jobs')
        .insert({
          source_type: source,
          source_name:
            sourceName ??
            (source === 'google_sheets'
              ? 'google-sheet'
              : `upload.${source === 'excel' ? 'xlsx' : 'csv'}`),
          google_sheet_id: sheetId,
          status,
          total_rows: validated.length,
          valid_rows: validRows,
          invalid_rows: invalidRows,
          created_by: auth.userId,
          validated_at: now,
        })
        .select('*')
        .single();
      if (jobError) throw jobError;
      const jobId = (job as { id: string }).id;
      const persistedIds: string[] = [];
      for (const v of validated) {
        const { data: saved, error: rowError } = await db
          .from('customer_import_rows')
          .insert({
            import_job_id: jobId,
            row_number: v.rowNumber,
            raw_data: v.fields,
            normalized_data: v.normalized ?? {},
            validation_status:
              v.errors.length > 0 ? 'error' : v.warnings.length > 0 ? 'warning' : 'valid',
            validation_errors: v.errors,
            validation_warnings: v.warnings,
            action: v.action,
            customer_id: v.customerId,
            membership_id: v.membershipId,
          })
          .select('id')
          .single();
        if (rowError) throw rowError;
        persistedIds.push((saved as { id: string }).id);
      }
      await audit(db, auth.userId, 'CUSTOMER_IMPORT_PARSED', 'customer_import_job', jobId, null, {
        status,
        total: validated.length,
        valid: validRows,
      });
      const payload = {
        job: shapeJob(job as Record<string, unknown>),
        rows: validated.map((v, i) =>
          shapeRow({
            id: persistedIds[i]!,
            row_number: v.rowNumber,
            raw_data: v.fields,
            normalized_data: v.normalized ?? {},
            validation_status:
              v.errors.length > 0 ? 'error' : v.warnings.length > 0 ? 'warning' : 'valid',
            validation_errors: v.errors,
            validation_warnings: v.warnings,
            action: v.action,
            customer_id: v.customerId,
            membership_id: v.membershipId,
          }),
        ),
      };
      const checked = customerImportParseResponseSchema.safeParse(payload);
      if (!checked.success) return fail(res, 'INTERNAL', 'Import preview failed validation', 500);
      return res.status(201).json(checked.data);
    }

    if (method(req) === 'GET' && path === 'jobs') {
      const auth = await authorizeAfHomes(req, MODULE);
      if ('error' in auth) return deny(res, auth);
      const { data, error } = await db
        .from('customer_import_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return res
        .status(200)
        .json({ data: ((data ?? []) as Record<string, unknown>[]).map(shapeJob) });
    }

    const jobGet = route(req, 'GET', /^jobs\/([0-9a-f-]+)$/);
    if (jobGet) {
      const auth = await authorizeAfHomes(req, MODULE);
      if ('error' in auth) return deny(res, auth);
      const { data: job, error: jobError } = await db
        .from('customer_import_jobs')
        .select('*')
        .eq('id', jobGet[1]!)
        .maybeSingle();
      if (jobError) throw jobError;
      if (!job) return fail(res, 'NOT_FOUND', 'Import job not found', 404);
      const rows = await importRows(db, jobGet[1]!);
      return res.status(200).json({
        job: shapeJob(job as Record<string, unknown>),
        rows: ((rows ?? []) as Record<string, unknown>[]).map(shapeRow),
      });
    }

    const jobCancel = route(req, 'POST', /^jobs\/([0-9a-f-]+)\/cancel$/);
    if (jobCancel) {
      const auth = await authorizeAfHomes(req, MODULE, 'update');
      if ('error' in auth) return deny(res, auth);
      const { data: job, error: readError } = await db
        .from('customer_import_jobs')
        .select('id,status')
        .eq('id', jobCancel[1]!)
        .maybeSingle();
      if (readError) throw readError;
      if (!job) return fail(res, 'NOT_FOUND', 'Import job not found', 404);
      if (!['ready', 'validated'].includes((job as { status: string }).status))
        return fail(res, 'CONFLICT', 'Only a validated job can be cancelled', 409);
      const { error: writeError } = await db
        .from('customer_import_jobs')
        .update({ status: 'cancelled' })
        .eq('id', jobCancel[1]!);
      if (writeError) throw writeError;
      await audit(
        db,
        auth.userId,
        'CUSTOMER_IMPORT_CANCELLED',
        'customer_import_job',
        jobCancel[1]!,
        null,
        { status: 'cancelled' },
      );
      return res.status(200).json({ cancelled: true });
    }

    const jobConfirm = route(req, 'POST', /^jobs\/([0-9a-f-]+)\/confirm$/);
    if (jobConfirm) {
      const auth = await authorizeAfHomes(req, MODULE, 'update');
      if ('error' in auth) return deny(res, auth);
      const jobId = jobConfirm[1]!;
      const { data: job, error: readError } = await db
        .from('customer_import_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle();
      if (readError) throw readError;
      if (!job) return fail(res, 'NOT_FOUND', 'Import job not found', 404);
      if (
        !['ready', 'validated', 'committing', 'completed', 'completed_with_errors'].includes(
          (job as { status: string }).status,
        )
      )
        return fail(res, 'CONFLICT', 'Only a validated job can be confirmed', 409);
      const wasCompleted = ['completed', 'completed_with_errors'].includes(String(job.status));
      const { error: startError } = wasCompleted
        ? { error: null }
        : await db.from('customer_import_jobs').update({ status: 'committing' }).eq('id', jobId);
      if (startError) throw startError;
      const rows = await importRows(db, jobId);
      if (rows.length !== Number(job.total_rows))
        return fail(
          res,
          'CONFLICT',
          'Import row count is incomplete; retry after reviewing the job.',
          409,
        );
      const results: {
        rowId: string;
        ok: boolean;
        customerId: string | null;
        membershipId: string | null;
        error: string | null;
      }[] = [];
      let inserted = 0;
      let updated = 0;
      for (const raw of (rows ?? []) as Record<string, unknown>[]) {
        const rowId = String(raw.id);
        const action = String(raw.action);
        const validation = String(raw.validation_status);
        if (validation === 'error' || action === 'CONFLICT') {
          results.push({
            rowId,
            ok: false,
            customerId: null,
            membershipId: null,
            error: 'Row validation failed; review source data.',
          });
          continue;
        }
        if (action !== 'CREATE' && action !== 'UPDATE') {
          results.push({
            rowId,
            ok: true,
            customerId: (raw.customer_id as string | null) ?? null,
            membershipId: (raw.membership_id as string | null) ?? null,
            error: null,
          });
          continue;
        }
        try {
          if (action === 'CREATE') {
            const out = await commitCreateRow(db, auth.userId, raw);

            inserted += 1;
            results.push({
              rowId,
              ok: true,
              customerId: out.customerId,
              membershipId: out.membershipId,
              error: null,
            });
          } else {
            const out = await commitUpdateRow(db, auth.userId, raw);
            updated += 1;
            results.push({
              rowId,
              ok: true,
              customerId: out.customerId,
              membershipId: out.membershipId,
              error: null,
            });
          }
        } catch (error) {
          const safeMessages: Record<string, string> = {
            IMPORT_NOT_FULLY_PAID: 'Verified historical payments must cover the plan price.',
            IMPORT_DUPLICATE_EMAIL: 'This email already belongs to a customer.',
            IMPORT_DUPLICATE_MEMBERSHIP: 'This membership number is already in use.',
            IMPORT_REACTIVATION_CONFLICT:
              'Reactivation conflict: existing suspended/expired/cancelled, requested active.',
            IMPORT_IDENTIFIER_CONFLICT: 'Supplied identifiers resolve to different customers.',
            IMPORT_BAD_PAYMENT: 'Historical amount, date and method are required.',
            IMPORT_HISTORICAL_TOTAL_REQUIRED: 'Historical sale total is required.',
            IMPORT_TIER_CONFLICT: 'The imported tier conflicts with the existing membership.',
            IMPORT_STATUS_CONFLICT:
              'The existing membership cannot make this lifecycle transition.',
            IMPORT_REFERRAL_INVALID: 'The referral or seller code is no longer valid.',
            IMPORT_EXISTING_CUSTOMER_NEEDS_MEMBERSHIP:
              'The existing customer needs its normal sale and membership workflow.',
            SALE_COMPLETE_HIERARCHY_REQUIRED:
              'Complete the seller hierarchy before creating this sale.',
          };
          const code =
            error !== null && typeof error === 'object' && 'message' in error
              ? (String(error.message).split(':')[0] ?? '')
              : '';
          const message =
            code === 'IMPORT_REACTIVATION_CONFLICT'
              ? String(
                  error !== null && typeof error === 'object' && 'message' in error
                    ? error.message
                    : '',
                )
              : (safeMessages[code] ?? 'Import failed. Retry after reviewing the row.');
          const { error: failureError } = await db
            .from('customer_import_rows')
            .update({
              validation_status: 'error',
              action: 'CONFLICT',
              validation_errors: [{ field: '_row', message }],
            })
            .eq('id', rowId);
          if (failureError) throw failureError;
          results.push({
            rowId,
            ok: false,
            customerId: null,
            membershipId: null,
            error: message.slice(0, 200),
          });
        }
      }
      const failed = results.filter((r) => !r.ok).length;
      const skipped = ((rows ?? []) as unknown[]).length - inserted - updated - failed;
      const { error: completionError } = await db
        .from('customer_import_jobs')
        .update({
          status: failed > 0 ? 'completed_with_errors' : 'completed',
          inserted_rows: inserted,
          updated_rows: updated,
          skipped_rows: skipped,
          failed_rows: failed,
          invalid_rows: failed,
          valid_rows: ((rows ?? []) as unknown[]).length - failed,
          committed_at: new Date().toISOString(),
        })
        .eq('id', jobId);
      if (completionError) throw completionError;
      await audit(
        db,
        auth.userId,
        'CUSTOMER_IMPORT_COMMITTED',
        'customer_import_job',
        jobId,
        null,
        { inserted, updated, failed },
      );
      const payload = {
        job: {
          ...(job as Record<string, unknown>),
          status: failed > 0 ? 'completed_with_errors' : 'completed',
          inserted_rows: inserted,
          updated_rows: updated,
          skipped_rows: skipped,
          failed_rows: failed,
          invalid_rows: failed,
          valid_rows: ((rows ?? []) as unknown[]).length - failed,
          committed_at: new Date().toISOString(),
        },
        committed: inserted + updated,
        failed,
        rowResults: results,
      };
      const checked = customerImportCommitResponseSchema.safeParse({
        ...payload,
        job: shapeJob(payload.job),
      });
      if (!checked.success) return fail(res, 'INTERNAL', 'Import result failed validation', 500);
      return res.status(200).json(checked.data);
    }

    const exportMatch = route(req, 'GET', /^export\/(xlsx|csv)$/);
    if (exportMatch) {
      const auth = await authorizeAfHomes(req, MODULE);
      if ('error' in auth) return deny(res, auth);
      const parsed = exportQuerySchema.safeParse(req.query);
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid export query', 400);
      const rows = await buildExportRows(db, parsed.data);
      if (exportMatch[1] === 'csv')
        return sendFile(
          res,
          'afhomes-customers.csv',
          'text/csv',
          new TextEncoder().encode(customerExportCsv(rows)),
        );
      return sendFile(
        res,
        'afhomes-customers.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        customerExportXlsx(rows),
      );
    }

    return fail(res, 'NOT_FOUND', 'Customer import endpoint not found', 404);
  } catch (error) {
    console.error('[api] customer import:', error instanceof Error ? error.message : error);
    return mapRpcError(res, error as { message?: string });
  }
}

/* ------------------------------------------------------------------ */
/* Commit: one independently-atomic row at a time                      */
/* ------------------------------------------------------------------ */

async function importRows(db: Db, jobId: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset <= 5000; offset += 500) {
    const page = await db
      .from('customer_import_rows')
      .select('*')
      .eq('import_job_id', jobId)
      .order('row_number')
      .range(offset, offset + 499);
    if (page.error) throw page.error;
    rows.push(...((page.data ?? []) as Record<string, unknown>[]));
    if (rows.length > 5000) throw new Error('Import row limit exceeded');
    if ((page.data ?? []).length < 500) break;
  }
  return rows;
}
async function commitCreateRow(db: Db, actorId: string, raw: Record<string, unknown>) {
  const { data, error } = await db.rpc('commit_customer_import_row', {
    p_row_id: raw.id,
    p_actor_id: actorId,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as {
    customerId: string;
    membershipId: string | null;
    saleId: string | null;
  };
}
const commitUpdateRow = commitCreateRow;

/* ------------------------------------------------------------------ */
/* Export rows: authoritative reads, derived display, filtered         */
/* ------------------------------------------------------------------ */

type ExportFilters = {
  category?: string;
  tier?: string;
  seller?: string;
  from?: string;
  to?: string;
  search?: string;
  limit: number;
};

async function buildExportRows(db: Db, filters: ExportFilters): Promise<CustomerExportRow[]> {
  const directory = await customerDirectory(db, {
    ...filters,
    category: Object.entries(CUSTOMER_CATEGORY_LABELS).find(
      ([key, label]) => key === filters.category || label === filters.category,
    )?.[0],
    sort: 'created',
  });
  // Derived AGE is display-only, computed from the stored birthdays; the
  // value is never stored and a blank birthday exports a blank cell.
  const ageOn = (value: unknown): string => {
    const iso = typeof value === 'string' ? value.slice(0, 10) : '';
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const born = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(born.valueOf())) return '';
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    if (
      now.getMonth() < born.getMonth() ||
      (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
    )
      age -= 1;
    return age < 0 ? '' : String(age);
  };
  const text = (value: unknown): string => String(value ?? '');
  const date = (value: unknown): string => (isoOrNull(value) ?? '').slice(0, 10);
  const masked = (value: unknown): string => maskGovernmentId(text(value)) ?? '';
  const addressPart = (record: Record<string, unknown>, key: string): string => {
    const address = record.address;
    if (!address || typeof address !== 'object') return '';
    const part = (address as Record<string, unknown>)[key];
    return typeof part === 'string' ? part : '';
  };
  return directory.map(({ record: r }) => ({
    // PRIMARY block, SSOT order. TIN stays masked on this read surface too.
    'RA NO': text(r.ra_number),
    'STATUS': text(r.company_status),
    'FIRST NAME': text(r.first_name),
    'LAST NAME': text(r.last_name),
    'MIDDLE NAME': text(r.middle_name),
    'SUFFIX': text(r.suffix),
    'BIRTHDAY': date(r.birth_date),
    'GENDER': text(r.gender),
    'AGE': ageOn(r.birth_date),
    'CITIZENSHIP': text(r.citizenship),
    'CIVIL STATUS': text(r.civil_status),
    'PERMANENT ADDRESS LINE 1': addressPart(r, 'line1'),
    'PERMANENT ADDRESS LINE 2': addressPart(r, 'line2'),
    'PROVINCE': addressPart(r, 'province'),
    'CITY': addressPart(r, 'city'),
    'BARANGGAY': addressPart(r, 'barangay'),
    'POSTAL CODE': addressPart(r, 'postalCode'),
    'LANDLINE': text(r.landline),
    'EMAIL': text(r.email),
    'TIN NO.': masked(r.tin_number),
    'MOBILE NO.': text(r.phone),
    'OCCUPATION / BUSINESS NAME': text(r.occupation_business_name),
    'OFFICE / BUSINESS ADDRESS': text(r.office_business_address),
    'EMPLOYED POSITION': text(r.employed_position),
    // SUPPLEMENTARY block. Names and address are stored joined (single text
    // columns) and export as the two stored fields.
    'SUPPLEMENTARY FULL NAME': text(r.supplementary_full_name),
    'SUPPLEMENTARY ADDRESS': text(r.supplementary_address),
    'SUPPLEMENTARY BIRTHDAY': date(r.supplementary_birthday),
    'SUPPLEMENTARY GENDER': text(r.supplementary_gender),
    'SUPPLEMENTARY AGE': ageOn(r.supplementary_birthday),
    'SUPPLEMENTARY CITIZENSHIP': text(r.supplementary_citizenship),
    'SUPPLEMENTARY CIVIL STATUS': text(r.supplementary_civil_status),
    'SUPPLEMENTARY TIN NO.': masked(r.supplementary_tin_number),
    'SUPPLEMENTARY LANDLINE': text(r.supplementary_landline),
    'SUPPLEMENTARY MOBILE NO.': text(r.supplementary_mobile),
    'SUPPLEMENTARY EMAIL': text(r.supplementary_email),
    'SUPPLEMENTARY OCCUPATION / BUSINESS NAME': text(r.supplementary_occupation_business_name),
    'SUPPLEMENTARY OFFICE / BUSINESS ADDRESS': text(r.supplementary_office_address),
    'SUPPLEMENTARY EMPLOYED POSITION': text(r.supplementary_position),
    // OST/IST block, verbatim.
    'SVD (NAME)': text(r.svd_name),
    'SSM (NAME)': text(r.ssm_name),
    'SM (NAME)': text(r.sm_name),
    'REFERRER (NAME)': text(r.referrer_name),
    'VIP RECOMMENDER (NAME)': text(r.vip_recommender_name),
    'CONTACT NO.': text(r.related_contact_no),
    'EMAIL ADDRESS': text(r.related_email),
    // VIP PACKAGE block, verbatim stated facts.
    'VIP PACKAGE': text(r.stated_vip_package),
    'PAYMENT TERMS': text(r.stated_payment_terms),
    'REGULAR PRICE': text(r.stated_regular_price),
    'DISCOUNT': text(r.stated_discount),
    'TOTAL AMOUNT': text(r.stated_total_amount),
    'RF': text(r.stated_rf),
    'PAYMENT TYPE': text(r.stated_payment_type),
    'REF NO': text(r.stated_ref_no),
    'DATE': date(r.stated_payment_date),
    // System columns: identifiers and derived state, never company-stated.
    'CUSTOMER ID': text(r.customer_number),
    'CUSTOMER CODE': text(r.customer_code),
    'MEMBERSHIP NUMBER': text(r.membership_number),
    'CUSTOMER STATUS': text(r.status),
    'MEMBERSHIP STATUS': text(r.member_status),
    'PAYMENT STATUS': text(r.payment_status ?? 'no_payment'),
    'CATEGORY': CUSTOMER_CATEGORY_LABELS[customerCategorySchema.parse(r.derivedCategory)],
    'POINTS BALANCE': text(r.available_points),
    'SELLER': text(r.seller_name),
    'ACTIVATED AT': isoOrNull(r.activated_at) ?? '',
    'EXPIRES AT': isoOrNull(r.expires_at) ?? '',
    'CREATED AT': isoOrNull(r.created_at) ?? '',
  }));
}
