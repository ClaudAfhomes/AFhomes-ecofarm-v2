import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import { customerImportParseResponseSchema } from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { MAX_IMPORT_BYTES, membershipTemplateV2Csv } from './customer-import.js';
import { readCustomerImportFile, validateCustomerImportFile } from './customer-import-file.js';
import { loadMongoCustomerImportContext } from './customer-import-context.mongo.js';
import { shapeImportJob, shapeImportRow } from './customer-import-model.js';
import {
  annotateCustomerWorkbook,
  annotateFlatCustomerImport,
} from './customer-workflow-review.js';
import { customerWorkflowTemplate } from './customer-workflow-export.js';
import { createMongoPurchaseRecords, allocatePurchaseId } from './purchase-records.mongo.js';
import type { createMongoImportContinuationHandlers } from './import-continuation.mongo.js';
import { createMongoImportJobCommitHandler } from './import-job-commit.mongo.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

const inputSchema = z.object({
  source: z.enum(['csv', 'excel', 'google_sheets']),
  contentBase64: z
    .string()
    .max(MAX_IMPORT_BYTES * 2)
    .optional(),
  sheetUrl: z.string().trim().max(500).optional(),
  sourceName: z.string().trim().min(1).max(200).optional(),
  externalVerificationReason: z.string().trim().min(10).max(500).optional(),
});
const pageSchema = z.object({
  offset: z.coerce.number().int().min(0).max(4999).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};

export async function setupMongoImportJobs(db: Db) {
  await db
    .collection('customer_import_jobs')
    .createIndex(
      { job_number: 1 },
      { unique: true, partialFilterExpression: { job_number: { $type: 'string' } } },
    );
  await db
    .collection('customer_import_rows')
    .createIndex(
      { import_job_id: 1, row_number: 1 },
      { unique: true, partialFilterExpression: { row_number: { $type: 'number' } } },
    );
}

/** Workbook intake persists review evidence only; business commit is a separate guarded workflow. */
export function createMongoCustomerImportJobsHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  continuation: ReturnType<typeof createMongoImportContinuationHandlers>,
) {
  const col = (table: string) => db.collection<MongoRow>(table),
    records = createMongoPurchaseRecords(db);
  const preview = continuation.preview, confirm = createMongoImportJobCommitHandler(db,client,authorize,continuation);
  const jobView = (row: MongoRow) => shapeImportJob({ ...row, id: row._id });
  const rowView = (row: MongoRow) => shapeImportRow({ ...row, id: row._id });
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = subPath(req),
      verb = method(req),
      match = /^jobs\/([^/]+)(?:\/(cancel|confirm))?$/.exec(path);
    if (verb === 'POST' && match?.[2] === 'confirm') return confirm(req,res,match[1]!);
    const parsing = path === 'parse' && verb === 'POST',
      cancelling = !!match?.[2] && verb === 'POST';
    if (
      !parsing &&
      !cancelling &&
      !(
        verb === 'GET' &&
        (['jobs', 'template/xlsx', 'template/csv'].includes(path) || (match && !match[2]))
      )
    )
      return fail(res, 'NOT_IMPLEMENTED', 'This native import workflow is not enabled', 501);
    const session = client.startSession();
    try {
      const actor = await authorize(
        req,
        'governance.customer_import',
        parsing ? 'create' : cancelling ? 'update' : 'view',
      );
      if ('error' in actor) return deny(res, actor);
      if (match && !z.uuid().safeParse(match[1]).success) refuse(400, 'Invalid import job');
      if (path.startsWith('template/')) {
        let bytes: Uint8Array;
        if (path === 'template/xlsx') {
          const access = await authorize(req, 'sales.customers', 'view');
          if ('error' in access) return deny(res, access);
          bytes = customerWorkflowTemplate(
            (await loadMongoCustomerImportContext(db, [])).staffMatches,
          );
        } else bytes = new TextEncoder().encode(membershipTemplateV2Csv());
        return res.status(200).json({
          filename: path.endsWith('xlsx')
            ? 'customer-workflow-template.xlsx'
            : 'membership-template.csv',
          mime: path.endsWith('xlsx')
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv',
          content: Buffer.from(bytes).toString('base64'),
        });
      }
      if (verb === 'GET') {
        if (path === 'jobs')
          return res.status(200).json({
            data: (
              await col('customer_import_jobs').find().sort({ created_at: -1 }).limit(100).toArray()
            ).map(jobView),
          });
        const job = await col('customer_import_jobs').findOne({ _id: match![1]! });
        if (!job) refuse(404, 'Import job not found');
        const page = pageSchema.safeParse(req.query);
        if (!page.success) refuse(400, 'Invalid preview page');
        if (!page.success) return;
        const rows = await col('customer_import_rows')
          .find({ import_job_id: job!._id })
          .sort({ row_number: 1 })
          .skip(page.data.offset)
          .limit(page.data.limit)
          .toArray();
        return res
          .status(200)
          .json({ job: jobView(job!), pageSize: page.data.limit, rows: rows.map(rowView) });
      }
      if (cancelling) {
        await session.withTransaction(async () => {
          await db
            .collection<{ _id: string; seq: number }>('counters')
            .updateOne(
              { _id: 'organization-write' },
              { $inc: { seq: 1 } },
              { upsert: true, session },
            );
          const access = await authorize(req, 'governance.customer_import', 'update');
          if ('error' in access) refuse(access.error.status, 'Import update is not permitted');
          const job = await col('customer_import_jobs').findOne({ _id: match![1]! }, { session });
          if (!job) refuse(404, 'Import job not found');
          if (!['ready', 'validated'].includes(String(job!.status)))
            refuse(409, 'The import job changed; reload before cancelling');
          await col('customer_import_jobs').updateOne(
            { _id: job!._id },
            { $set: { status: 'cancelled', cancelled_at: new Date().toISOString() } },
            { session },
          );
          await records.audit(
            actor.userId,
            'CUSTOMER_IMPORT_CANCELLED',
            'customer_import_job',
            job!._id,
            null,
            { status: 'cancelled' },
            session,
          );
        });
        return res.status(200).json({ cancelled: true });
      }
      const parsed = inputSchema.safeParse(jsonBody(req));
      if (!parsed.success) refuse(400, 'Invalid import request');
      if (!parsed.success) return;
      const historicalPermissions = async () => {
        for (const [module, action] of [
          ['sales.customers', 'create'],
          ['sales.card_sales', 'create'],
          ['finance.payment_verification', 'update'],
        ] as const) {
          const access = await authorize(req, module, action);
          if ('error' in access) refuse(access.error.status, 'Historical certification is not permitted');
        }
      };
      if (parsed.data.externalVerificationReason) await historicalPermissions();
      let file: Awaited<ReturnType<typeof readCustomerImportFile>>;
      try {
        file = await readCustomerImportFile(parsed.data);
      } catch (error) {
        return fail(
          res,
          'VALIDATION_ERROR',
          error instanceof Error ? error.message : 'Unparseable file',
          400,
        );
      }
      const { ctx, staffMatches, raOwners } = await loadMongoCustomerImportContext(
        db,
        file.records,
      );
      const validated = await validateCustomerImportFile(
        file, ctx, staffMatches, raOwners, parsed.data.externalVerificationReason,
      );
      const id = randomUUID(),
        now = new Date().toISOString();
      // Review reads stay outside the short atomic evidence write.
      const rows: MongoRow[] = [];
      for (const value of validated) {
        const row: MongoRow = {
          _id: randomUUID(),
          import_job_id: id,
          row_number: value.rowNumber,
          raw_data: value.fields,
          normalized_data: value.normalized ?? {},
          validation_status: value.errors.length
            ? 'error'
            : value.warnings.length
              ? 'warning'
              : 'valid',
          validation_errors: value.errors,
          validation_warnings: value.warnings,
          action: value.action,
          customer_id: value.customerId,
          membership_id: value.membershipId,
          committed_at: null,
        };

        if (
          !value.errors.length &&
          ['CREATE', 'UPDATE'].includes(value.action) &&
          value.normalized?.customerFacts
        ) {
          try {
            const continuation = await preview(row, session);
            value.normalized.continuationPreview = continuation;
            if (continuation.stage === 'review' || continuation.conflicts.length)
              value.errors.push(
                ...continuation.conflicts,
                ...continuation.missingRequirements.map((message) => ({
                  field: 'external_history',
                  message,
                })),
              );
          } catch (error) {
            if (!(error instanceof CustomerActivationError)) throw error;
            value.errors.push({ field: 'external_history', message: error.message });
          }
          row.normalized_data = value.normalized;
          row.validation_errors = value.errors;
          row.validation_status = value.errors.length
            ? 'error'
            : value.warnings.length
              ? 'warning'
              : 'valid';
        }
        rows.push(row);
      }
      const result = await session.withTransaction(async () => {
        await db
          .collection<{ _id: string; seq: number }>('counters')
          .updateOne(
            { _id: 'organization-write' },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
        const access = await authorize(req, 'governance.customer_import', 'create');
        if ('error' in access) refuse(access.error.status, 'Import creation is not permitted');
        if (parsed.data.externalVerificationReason) await historicalPermissions();

        const job: MongoRow = {
          _id: id,
          job_number: await allocatePurchaseId(
            db,
            'AF-IMP',
            'customer_import_jobs',
            'job_number',
            session,
          ),
          source_type: parsed.data.source,
          source_name:
            parsed.data.sourceName ??
            (parsed.data.source === 'google_sheets'
              ? 'google-sheet'
              : `upload.${parsed.data.source === 'excel' ? 'xlsx' : 'csv'}`),
          google_sheet_id: file.sheetId,
          status: validated.every((v) => !v.errors.length) ? 'ready' : 'validated',
          total_rows: validated.length,
          valid_rows: validated.filter((v) => !v.errors.length).length,
          invalid_rows: validated.filter((v) => v.errors.length).length,
          inserted_rows: 0,
          updated_rows: 0,
          skipped_rows: 0,
          created_by: actor.userId,
          created_at: now,
          validated_at: now,
          committed_at: null,
          failed_at: null,
          cancelled_at: null,
          failed_rows: 0,
        };
        await col('customer_import_jobs').insertOne(job, { session });
        if (rows.length) await col('customer_import_rows').insertMany(rows, { session });
        await records.audit(
          actor.userId,
          'CUSTOMER_IMPORT_PARSED',
          'customer_import_job',
          id,
          null,
          {
            status: job.status,
            total: validated.length,
            valid: job.valid_rows,
            sourceHash: file.sourceHash,
          },
          session,
        );
        return { job: jobView(job), pageSize: 10, rows: rows.slice(0, 10).map(rowView) };
      });
      const reviewBytes = file.workflowReview
        ? annotateCustomerWorkbook(
            file.workflowReview.bytes,
            file.workflowReview.workbook,
            validated,
          )
        : file.reviewMatrix
          ? annotateFlatCustomerImport(file.reviewMatrix, validated)
          : null;
      return res.status(201).json(
        customerImportParseResponseSchema.parse({
          ...result,
          ...(reviewBytes
            ? {
                reviewFile: {
                  filename: 'customer-import-review.xlsx',
                  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  content: Buffer.from(reviewBytes).toString('base64'),
                },
              }
            : {}),
        }),
      );
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 400
            ? 'VALIDATION_ERROR'
            : error.status === 403
              ? 'FORBIDDEN'
              : error.status === 404
                ? 'NOT_FOUND'
                : error.status === 501
                  ? 'NOT_IMPLEMENTED'
                  : 'CONFLICT',
          error.message,
          error.status,
        );
      return fail(res, 'INTERNAL', 'Import review is unavailable. Please retry.', 503);
    } finally {
      await session.endSession();
    }
  };
}
