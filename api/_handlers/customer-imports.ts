import { customerDirectory } from '../_lib/customer-directory.js';
import { z } from 'zod';
import {
  CUSTOMER_EXPORT_COLUMNS,
  CUSTOMER_CATEGORY_LABELS,
  customerCategorySchema,
  customerImportCommitResponseSchema,
  customerImportJobSchema,
  customerImportParseResponseSchema,
  type CustomerExportRow,
} from '@afhomes/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  customerExportCsv,
  customerImportTemplateCsv,
  fetchGoogleSheetCsv,
  matrixToRecords,
  parseCsvMatrix,
  parseXlsxMatrix,
  validateImportRow,
  type ImportContext,
  type ValidatedImportRow,
} from '../_lib/customer-import.js';
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
import {
  parseCustomerWorkbook,
  validateWorkbookFields,
  resolveWorkbookGeography,
  sameWorkbookIdentity,
  resolveWorkbookStaff,
  type WorkbookStaffMatch,
  workbookApplicationPrefill,
} from '../_lib/customer-workbook.js';
import { addressProvider } from '../_lib/address-source.js';
import { companyTemplate, companyWorkbook } from '../_lib/customer-workbook-export.js';
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
  const customerIdentityById = new Map<string, Record<string, string | null>>();
  const identityIds = [
    ...new Set(
      [
        ...customerByEmail.values(),
        ...customerByNumber.values(),
        ...[...membershipByNumber.values()].map((member) => ({ id: member.customerId })),
      ].map((customer) => customer.id),
    ),
  ];
  for (let offset = 0; offset < identityIds.length; offset += 100) {
    const identities = await db
      .from('customers')
      .select('id,first_name,middle_name,last_name,suffix,email,phone,birth_date')
      .in('id', identityIds.slice(offset, offset + 100));
    if (identities.error) throw identities.error;
    for (const row of (identities.data ?? []) as Record<string, unknown>[]) {
      const values: Record<string, string | null> = {};
      for (const key of [
        'first_name',
        'middle_name',
        'last_name',
        'suffix',
        'email',
        'phone',
        'birth_date',
      ])
        values[key] = typeof row[key] === 'string' ? row[key] : null;
      customerIdentityById.set(String(row.id), values);
    }
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
    customerIdentityById,
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
        'afhomes-customer-import-template.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        companyTemplate(),
      );
    }
    if (method(req) === 'GET' && path === 'template/csv') {
      const auth = await authorizeAfHomes(req, MODULE);
      if ('error' in auth) return deny(res, auth);
      return sendFile(
        res,
        'afhomes-customer-import-template.csv',
        'text/csv',
        new TextEncoder().encode(customerImportTemplateCsv()),
      );
    }

    if (method(req) === 'POST' && path === 'parse') {
      const auth = await authorizeAfHomes(req, MODULE, 'create');
      if ('error' in auth) return deny(res, auth);
      const parsed = parseSchema.safeParse(jsonBody(req));
      if (!parsed.success) return fail(res, 'VALIDATION_ERROR', 'Invalid import request', 400);
      const { source, sourceName } = parsed.data;
      let matrix: string[][];
      let workbookRecords: ReturnType<typeof parseCustomerWorkbook> = null;
      let sheetId: string | null = null;
      let sourceHash: string | null = null;
      try {
        if (source === 'google_sheets') {
          if (!parsed.data.sheetUrl)
            return fail(res, 'VALIDATION_ERROR', 'A Google Sheets URL is required', 400);
          const csv = await fetchGoogleSheetCsv(parsed.data.sheetUrl);
          sourceHash = hashIdentifier(csv);
          const { parseGoogleSheetUrl: parseUrl } = await import('@afhomes/contracts');
          sheetId = parseUrl(parsed.data.sheetUrl)?.spreadsheetId ?? null;
          matrix = parseCsvMatrix(csv);
        } else {
          if (!parsed.data.contentBase64)
            return fail(res, 'VALIDATION_ERROR', 'File content is required', 400);
          const bytes = new Uint8Array(Buffer.from(parsed.data.contentBase64, 'base64'));
          sourceHash = hashIdentifier(Buffer.from(bytes).toString('base64'));
          if (bytes.length === 0 || bytes.length > MAX_IMPORT_BYTES)
            return fail(res, 'VALIDATION_ERROR', 'File is empty or exceeds the size limit', 400);
          if (source === 'excel') {
            workbookRecords = parseCustomerWorkbook(bytes);
            matrix = workbookRecords ? [] : parseXlsxMatrix(bytes);
          } else matrix = parseCsvMatrix(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
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
      try {
        const converted = workbookRecords ?? matrixToRecords(matrix);
        records = converted.rows;
        unknownHeaders = converted.unknownHeaders;
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
        if (!workbookRecords) delete record.fields.workbook_format;
        if (!record.fields.source_status && record.fields.derived_category)
          record.fields.source_status = record.fields.derived_category;
      }
      const ctx = await buildContext(db, records);
      const raOwners = new Map<string, Set<string>>();
      const staffMatches: WorkbookStaffMatch[] = [];
      if (workbookRecords) {
        const names = [
          ...new Set(
            records
              .flatMap((r) =>
                ['vd_name', 'ssm_name', 'sm_name', 'referrer_name'].map(
                  (key) => r.fields[key] ?? '',
                ),
              )
              .filter(Boolean),
          ),
        ];
        for (let offset = 0; offset < names.length; offset += 200) {
          const lookup = await db.rpc('match_company_import_staff', {
            p_names: names.slice(offset, offset + 200),
          });
          if (lookup.error) throw lookup.error;
          staffMatches.push(...((lookup.data ?? []) as WorkbookStaffMatch[]));
        }
        const ras = [...new Set(records.map((r) => r.fields.ra_number ?? '').filter(Boolean))];
        for (let offset = 0; offset < ras.length; offset += 100) {
          const batch = ras.slice(offset, offset + 100);
          const prior = await db
            .from('customer_import_rows')
            .select('raw_data,committed_at')
            .in('raw_data->>ra_number', batch);
          if (prior.error) throw prior.error;
          for (const record of (prior.data ?? []) as {
            raw_data: Record<string, string>;
            committed_at: string | null;
          }[]) {
            if (!record.committed_at) continue;
            const ra = record.raw_data.ra_number!;
            const owners = raOwners.get(ra) ?? new Set<string>();
            owners.add((record.raw_data.email ?? '').toLowerCase());
            raOwners.set(ra, owners);
          }
          const agreements = await db
            .from('reservation_agreements')
            .select('reservation_number')
            .in('reservation_number', batch);
          if (agreements.error) throw agreements.error;
          for (const agreement of (agreements.data ?? []) as { reservation_number: string }[])
            raOwners.set(agreement.reservation_number, new Set(['*']));
        }
        ctx.companySnapshots = new Map();
        const ids = [...new Set([...ctx.customerByEmail.values()].map((c) => c.id))];
        for (let offset = 0; offset < ids.length; offset += 100) {
          const batch = ids.slice(offset, offset + 100);
          const existing = await db
            .from('customers')
            .select('id,first_name,last_name,middle_name,phone,birth_date')
            .in('id', batch);
          if (existing.error) throw existing.error;
          const snapshots = await db
            .from('customer_import_rows')
            .select('customer_id,raw_data,committed_at')
            .in('customer_id', batch)
            .order('committed_at', { ascending: false });
          if (snapshots.error) throw snapshots.error;
          for (const snapshot of (snapshots.data ?? []) as {
            customer_id: string;
            raw_data: Record<string, string>;
            committed_at: string | null;
          }[]) {
            if (
              !snapshot.committed_at ||
              snapshot.raw_data.workbook_format !== 'company_v1' ||
              ctx.companySnapshots.has(snapshot.customer_id)
            )
              continue;
            const current = ((existing.data ?? []) as Record<string, string>[]).find(
              (c) => c.id === snapshot.customer_id,
            );
            if (current)
              ctx.companySnapshots.set(snapshot.customer_id, {
                fields: snapshot.raw_data,
                current,
              });
          }
        }
      }
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(
        new Date(),
      );
      const seen = new Map<string, number>();
      const validated: ValidatedImportRow[] = [];
      for (const r of records) {
        const v = validateImportRow(
          r.rowNumber,
          workbookRecords && r.fields.suffix === 'N/A' ? { ...r.fields, suffix: '' } : r.fields,
          ctx,
          today,
        );
        if (workbookRecords) {
          validateWorkbookFields(r.fields, v);
          resolveWorkbookStaff(r.fields, staffMatches, v);
          await resolveWorkbookGeography(r.fields, addressProvider(), v);
          try {
            workbookApplicationPrefill(r.fields);
          } catch (error) {
            if (!(error instanceof z.ZodError)) throw error;
            v.errors.push(
              ...error.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message,
              })),
            );
          }
          const owners = raOwners.get(r.fields.ra_number ?? '');
          if (owners && [...owners].some((email) => email !== r.fields.email?.toLowerCase()))
            v.errors.push({
              field: 'ra_number',
              message:
                'Reservation agreement reference belongs to an existing record; manual identity review required',
            });
          for (const field of ['email', 'ra_number', 'customer_number']) {
            const value = r.fields[field]?.trim().toLowerCase();
            if (!value) continue;
            const key = field + ':' + value;
            const previous = seen.get(key);
            if (previous !== undefined) {
              v.errors.push({ field, message: `Duplicate identity in Excel row ${previous}` });
              const first = validated.find((row) => row.rowNumber === previous)!;
              first.errors.push({
                field,
                message: `Duplicate identity in Excel row ${r.rowNumber}`,
              });
              first.validation = 'error';
              first.action = 'CONFLICT';
              first.normalized = null;
            } else seen.set(key, r.rowNumber);
          }
          // A matched identity is reviewed separately; bulk imports never overwrite it.
          if (v.customerId) {
            const previous = ctx.companySnapshots?.get(v.customerId);
            const unchanged =
              previous &&
              ['first_name', 'last_name', 'middle_name', 'birth_date'].every(
                (key) => (previous.current[key] ?? '') === (r.fields[key] ?? ''),
              ) &&
              previous.current.phone === r.fields.mobile;
            if (unchanged && sameWorkbookIdentity(r.fields, previous.fields)) v.action = 'SKIP';
            else
              v.errors.push({
                field: 'email',
                message:
                  'Existing customer: review identity and supplementary information before changing protected records',
              });
          }
          v.fields = { ...v.fields, ...r.fields };
          if (v.errors.length) {
            v.validation = 'error';
            v.action = 'CONFLICT';
            v.normalized = null;
          }
        }
        for (const h of unknownHeaders)
          v.warnings.push({ field: h, message: 'Unknown column: ignored' });
        if (v.errors.length === 0 && v.warnings.length > 0) v.validation = 'warning';
        validated.push(v);
      }
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
      try {
        for (let offset = 0; offset < validated.length; offset += 100) {
          const batch = validated.slice(offset, offset + 100);
          const { data: saved, error: rowError } = await db
            .from('customer_import_rows')
            .insert(
              batch.map((v) => ({
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
              })),
            )
            .select('id,row_number');
          if (rowError) throw rowError;
          for (const row of batch) {
            const entry = ((saved ?? []) as { id: string; row_number: number }[]).find(
              (s) => s.row_number === row.rowNumber,
            );
            if (!entry) throw new Error('Import row persistence was incomplete');
            persistedIds.push(entry.id);
          }
        }
      } catch (error) {
        const failure = await db
          .from('customer_import_jobs')
          .update({ status: 'failed', failed_at: new Date().toISOString() })
          .eq('id', jobId);
        if (failure.error) throw failure.error;
        await audit(
          db,
          auth.userId,
          'CUSTOMER_IMPORT_PARSE_FAILED',
          'customer_import_job',
          jobId,
          null,
          { sourceHash, storedRows: persistedIds.length },
        );
        throw error;
      }
      await audit(db, auth.userId, 'CUSTOMER_IMPORT_PARSED', 'customer_import_job', jobId, null, {
        status,
        total: validated.length,
        valid: validRows,
        sourceHash,
      });
      const payload = {
        job: shapeJob(job as Record<string, unknown>),
        pageSize: 10,
        rows: validated.slice(0, 10).map((v, i) =>
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
      const pagination = z
        .object({
          offset: z.coerce.number().int().min(0).max(4999).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(10),
        })
        .safeParse(req.query);
      if (!pagination.success) return fail(res, 'VALIDATION_ERROR', 'Invalid preview page', 400);
      const page = await db
        .from('customer_import_rows')
        .select('*')
        .eq('import_job_id', jobGet[1]!)
        .order('row_number')
        .range(pagination.data.offset, pagination.data.offset + pagination.data.limit - 1);
      if (page.error) throw page.error;
      const rows = page.data ?? [];
      return res.status(200).json({
        job: shapeJob(job as Record<string, unknown>),
        pageSize: pagination.data.limit,
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
      const { data: cancelled, error: writeError } = await db
        .from('customer_import_jobs')
        .update({ status: 'cancelled' })
        .eq('id', jobCancel[1]!)
        .in('status', ['ready', 'validated'])
        .select('id')
        .maybeSingle();
      if (writeError) throw writeError;
      if (!cancelled)
        return fail(res, 'CONFLICT', 'The import job changed; reload before cancelling', 409);
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
      const { data: started, error: startError } = wasCompleted
        ? { data: { id: jobId }, error: null }
        : await db
            .from('customer_import_jobs')
            .update({ status: 'committing' })
            .eq('id', jobId)
            .in('status', ['ready', 'validated', 'committing'])
            .select('id')
            .maybeSingle();
      if (startError) throw startError;
      if (!started)
        return fail(res, 'CONFLICT', 'The import job changed; reload before confirming', 409);
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
      let pending = 0;
      let attempted = 0;
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
        if (raw.committed_at) {
          if (action === 'CREATE') inserted++;
          else updated++;
          results.push({
            rowId,
            ok: true,
            customerId: String(raw.customer_id),
            membershipId: (raw.membership_id as string | null) ?? null,
            error: null,
          });
          continue;
        }
        if (attempted >= 100) {
          pending++;
          continue;
        }
        attempted++;
        try {
          if (action === 'CREATE') {
            const out = await commitCreateRow(db, auth.userId, raw);

            if (out.action !== 'SKIP') inserted += 1;
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
            IMPORT_RA_REVIEW_REQUIRED:
              'Reservation agreement reference requires manual identity review.',
            IMPORT_STAFF_REVIEW_REQUIRED:
              'Registered staff identity or hierarchy changed; review and validate the workbook again.',
            IMPORT_IDENTITY_REVIEW_REQUIRED:
              'Existing customer details differ; review the protected identity before updating.',
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
      const skipped = ((rows ?? []) as unknown[]).length - inserted - updated - failed - pending;
      const { error: completionError } = await db
        .from('customer_import_jobs')
        .update({
          status: pending > 0 ? 'committing' : failed > 0 ? 'completed_with_errors' : 'completed',
          inserted_rows: inserted,
          updated_rows: updated,
          skipped_rows: skipped,
          failed_rows: failed,
          invalid_rows: failed,
          valid_rows: ((rows ?? []) as unknown[]).length - failed,
          committed_at: pending > 0 ? null : new Date().toISOString(),
        })
        .eq('id', jobId)
        .in(
          'status',
          pending > 0 ? ['committing'] : ['committing', 'completed', 'completed_with_errors'],
        );
      if (completionError) throw completionError;
      await audit(
        db,
        auth.userId,
        pending > 0 ? 'CUSTOMER_IMPORT_PROGRESS' : 'CUSTOMER_IMPORT_COMMITTED',
        'customer_import_job',
        jobId,
        null,
        { inserted, updated, failed },
      );
      const payload = {
        job: {
          ...(job as Record<string, unknown>),
          status: pending > 0 ? 'committing' : failed > 0 ? 'completed_with_errors' : 'completed',
          inserted_rows: inserted,
          updated_rows: updated,
          skipped_rows: skipped,
          failed_rows: failed,
          invalid_rows: failed,
          valid_rows: ((rows ?? []) as unknown[]).length - failed,
          committed_at: pending > 0 ? null : new Date().toISOString(),
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
      if (exportMatch[1] === 'csv') {
        const rows = await buildExportRows(db, parsed.data);
        return sendFile(
          res,
          'afhomes-customers.csv',
          'text/csv',
          new TextEncoder().encode(customerExportCsv(rows)),
        );
      }
      return sendFile(
        res,
        'afhomes-customers.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        companyWorkbook(await buildCompanyExportRows(db, parsed.data)),
      );
    }

    return fail(res, 'NOT_FOUND', 'Customer import endpoint not found', 404);
  } catch (error) {
    console.error('[api] customer import failed');
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
    action?: string;
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
  return directory.map(({ record: r }) => ({
    customer_number: String(r.customer_number ?? ''),
    membership_number: String(r.membership_number ?? ''),
    customer_name: String(r.full_name ?? ''),
    vip_tier: String(r.tier ?? ''),
    customer_status: String(r.status ?? ''),
    membership_status: String(r.member_status ?? ''),
    payment_status: String(r.payment_status ?? 'no_payment'),
    derived_category: CUSTOMER_CATEGORY_LABELS[customerCategorySchema.parse(r.derivedCategory)],
    activated_at: isoOrNull(r.activated_at) ?? '',
    expires_at: isoOrNull(r.expires_at) ?? '',
    current_points_balance: String(r.available_points ?? 0),
    seller: String(r.seller_name ?? ''),
    email: String(r.email ?? ''),
    mobile: String(r.phone ?? ''),
    created_at: isoOrNull(r.created_at) ?? '',
  }));
}

async function buildCompanyExportRows(
  db: Db,
  filters: ExportFilters,
): Promise<Record<string, string>[]> {
  const directory = await customerDirectory(db, { ...filters, sort: 'created' });
  const result: Record<string, string>[] = [];
  for (let offset = 0; offset < directory.length; offset += 100) {
    const entries = directory.slice(offset, offset + 100);
    const ids = entries.map(({ record }) => String(record.id));
    const customers = await db
      .from('customers')
      .select('id,first_name,last_name,middle_name,suffix,email,phone,birth_date,gender,address')
      .in('id', ids);
    if (customers.error) throw customers.error;
    const imported = await db
      .from('customer_import_rows')
      .select('customer_id,raw_data,committed_at')
      .in('customer_id', ids)
      .order('committed_at', { ascending: false });
    if (imported.error) throw imported.error;
    for (const { record } of entries) {
      const customer = ((customers.data ?? []) as Record<string, unknown>[]).find(
        (c) => c.id === record.id,
      );
      if (!customer) continue;
      const source = (
        (imported.data ?? []) as {
          customer_id: string;
          raw_data: Record<string, string>;
          committed_at: string | null;
        }[]
      ).find(
        (r) =>
          r.customer_id === record.id &&
          r.committed_at &&
          r.raw_data.workbook_format === 'company_v1',
      );
      const fields: Record<string, string> = { ...source?.raw_data };
      // Explicit person/address columns only; never government IDs, tokens or TIN.
      for (const key of ['first_name', 'last_name', 'middle_name', 'suffix', 'email'])
        fields[key] = String(customer[key] ?? '');
      fields.birth_date = isoOrNull(customer.birth_date)?.slice(0, 10) ?? '';
      fields.mobile = String(customer.phone ?? '').replace(/^\+63(?=9\d{9}$)/, '0');
      if (!source) {
        fields.sex =
          customer.gender === 'male' ? 'Male' : customer.gender === 'female' ? 'Female' : '';
        fields.stated_status =
          record.status === 'suspended'
            ? 'Suspended'
            : record.status === 'cancelled'
              ? 'Cancelled'
              : 'Pending';
        fields.vip_tier = String(record.tier ?? '');
        const address =
          customer.address && typeof customer.address === 'object'
            ? (customer.address as Record<string, unknown>)
            : {};
        for (const [key, attr] of Object.entries({
          address_line_1: 'line1',
          address_line_2: 'line2',
          city: 'city',
          province: 'province',
          barangay: 'barangay',
          postal_code: 'postalCode',
        }))
          fields[key] = String(address[attr] ?? '');
      }
      fields.tin = '';
      fields.secondary_tin = '';
      fields.system_customer_number = String(record.customer_number ?? '');
      fields.system_customer_status = String(record.status ?? '');
      fields.system_membership_status = String(record.member_status ?? 'none');
      fields.system_payment_status = String(record.payment_status ?? 'no_payment');
      fields.system_category = String(record.derivedCategory ?? '');
      result.push(fields);
    }
  }
  return result;
}
