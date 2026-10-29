import type { Db, MongoClient } from 'mongodb';
import { customerImportCommitResponseSchema } from '@afhomes/contracts';
import { z } from 'zod';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { createMongoImportSourceRecords } from './import-source.mongo.js';
import type { createMongoImportContinuationHandlers } from './import-continuation.mongo.js';
import { createMongoPurchaseRecords } from './purchase-records.mongo.js';
import { shapeImportJob } from './customer-import-model.js';
import { deny, fail } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';
import { requireMongoHistoricalImportSetup } from './historical-import.mongo.js';
import { commitMongoLegacyRow, isMongoLegacyIntake, isMongoLegacyMemberUpdate, isMongoLegacyMemberCreate, isMongoLegacyFinancialCreate } from './legacy-prospect-import.mongo.js';

/** Existing bounded confirm/retry protocol; each source is its own atomic business transaction. */
export function createMongoImportJobCommitHandler(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  reads: ReturnType<typeof createMongoImportContinuationHandlers>,
) {
  const col = (table: string) => db.collection<MongoRow>(table),
    sources = createMongoImportSourceRecords(db, authorize, reads),
    records = createMongoPurchaseRecords(db);
  return async (req: VercelRequest, res: VercelResponse, id: string) => {
    res.setHeader('Cache-Control', 'no-store');
    const actor = await authorize(req, 'governance.customer_import', 'update');
    if ('error' in actor) return deny(res, actor);
    if (!z.uuid().safeParse(id).success)
      return fail(res, 'VALIDATION_ERROR', 'Invalid import job', 400);
    const job = await col('customer_import_jobs').findOne({ _id: id });
    if (!job) return fail(res, 'NOT_FOUND', 'Import job not found', 404);
    if (
      !['ready', 'validated', 'committing', 'completed', 'completed_with_errors'].includes(
        String(job.status),
      )
    )
      return fail(res, 'CONFLICT', 'The import job changed; reload before confirming', 409);
    const rows = await col('customer_import_rows')
      .find({ import_job_id: id })
      .sort({ row_number: 1 })
      .toArray();
    if (rows.length !== job.total_rows)
      return fail(
        res,
        'CONFLICT',
        'Import row count is incomplete; review the job before retrying',
        409,
      );
    if (rows.some(r => isMongoLegacyIntake(r) || isMongoLegacyMemberUpdate(r) || isMongoLegacyMemberCreate(r) || isMongoLegacyFinancialCreate(r))) {
      const view = await authorize(req, 'governance.customer_import', 'view');
      if ('error' in view) return deny(res, view);
    }
    const historical = rows.filter((r) => !r.committed_at && r.validation_status !== 'error' && record(r.normalized_data).externalVerified === true);
    if (historical.length) {
      for (const [module, action] of [['sales.customers', 'create'], ['sales.card_sales', 'create'], ['finance.payment_verification', 'update']] as const) {
        const access = await authorize(req, module, action);
        if ('error' in access) return deny(res, access);
      }
      if (historical.some((r) => ['active', 'inactive'].includes(String(record(record(r.normalized_data).externalSummary).stage)))) {
        const access = await authorize(req, 'finance.card_activation', 'update');
        if ('error' in access) return deny(res, access);
      }
      try { await requireMongoHistoricalImportSetup(db); }
      catch { return fail(res, 'NOT_IMPLEMENTED', 'Historical import schema requires reviewed operator setup', 501); }
    }
    if (
      rows.some(
        (r) =>
          !r.committed_at &&
          r.validation_status !== 'error' &&
          !['company_v1', 'company_v2'].includes(String(record(r.raw_data).workbook_format)) && !isMongoLegacyIntake(r) && !isMongoLegacyMemberUpdate(r) && !isMongoLegacyMemberCreate(r) && !isMongoLegacyFinancialCreate(r),
      )
    )
      return fail(
        res,
        'NOT_IMPLEMENTED',
        'Use the guided workbook for historical payments or memberships; this legacy import is not enabled',
        501,
      );
    const session = client.startSession({ defaultTimeoutMS: 45_000 });
    try {
      await session.withTransaction(async () => {
        await db
          .collection<{ _id: string; seq: number }>('counters')
          .updateOne(
            { _id: 'organization-write' },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
        const fresh = await authorize(req, 'governance.customer_import', 'update');
        if ('error' in fresh)
          throw new CustomerActivationError(fresh.error.status, 'Import update is not permitted');
        const current = await col('customer_import_jobs').findOne({ _id: id }, { session });
        if (
          !current ||
          !['ready', 'validated', 'committing', 'completed', 'completed_with_errors'].includes(
            String(current.status),
          )
        )
          throw new CustomerActivationError(
            409,
            'The import job changed; reload before confirming',
          );
        if (!['completed', 'completed_with_errors'].includes(String(current.status)))
          await col('customer_import_jobs').updateOne(
            { _id: id },
            { $set: { status: 'committing' } },
            { session },
          );
      });
      const results: {
        rowId: string;
        ok: boolean;
        customerId: string | null;
        membershipId: string | null;
        error: string | null;
        importContinuation?: Record<string, unknown>;
      }[] = [];
      let attempted = 0;
      for (const entry of rows) {
        if (entry.validation_status === 'error' || entry.action === 'CONFLICT') {
          results.push({
            rowId: entry._id,
            ok: false,
            customerId: null,
            membershipId: null,
            error: 'Row validation failed; review source data.',
          });
          continue;
        }
        if (entry.committed_at || !['CREATE', 'UPDATE'].includes(String(entry.action))) {
          results.push({
            rowId: entry._id,
            ok: true,
            customerId: entry.customer_id ? String(entry.customer_id) : null,
            membershipId: entry.membership_id ? String(entry.membership_id) : null,
            error: null,
          });
          continue;
        }
        if (attempted++ >= 100) continue;
        try {
          const outcome = await session.withTransaction(async () => {
            for (const key of ['organization-write', 'sales-write'])
              await db
                .collection<{ _id: string; seq: number }>('counters')
                .updateOne({ _id: key }, { $inc: { seq: 1 } }, { upsert: true, session });
            const current = await col('customer_import_rows').findOne(
              { _id: entry._id },
              { session },
            );
            if (!current) throw new CustomerActivationError(409, 'The import row changed');
            if (!['company_v1', 'company_v2'].includes(String(record(current.raw_data).workbook_format)))
              return commitMongoLegacyRow(db, req, current, session, authorize);
            if (current.committed_at) return { customerId: current.customer_id ? String(current.customer_id) : null, continuation: await reads.preview(current, session), membershipId: current.membership_id ? String(current.membership_id) : null };
            const review = record(record(current.normalized_data).continuationPreview);
            if (
              typeof review.expectedSourceHash !== 'string' ||
              typeof review.expectedTargetVersion !== 'string'
            )
              throw new CustomerActivationError(
                409,
                'Review the import source again before confirming',
              );
            const continuation = await sources.commit(
              req,
              current._id,
              {
                expectedSourceHash: review.expectedSourceHash,
                expectedTargetVersion: review.expectedTargetVersion,
              },
              session,
            );
            const committed = await col('customer_import_rows').findOne({ _id: current._id }, { session, projection: { membership_id: 1 } });
            return { customerId: continuation.customerId, continuation, membershipId: committed?.membership_id ? String(committed.membership_id) : null };
          });
          const { continuation, membershipId } = outcome;
          results.push({
            rowId: entry._id,
            ok: true,
            customerId: outcome.customerId,
            membershipId,
            error: null,
            importContinuation: continuation,
          });
        } catch (error) {
          const message =
            error instanceof CustomerActivationError
              ? error.message
              : 'Import failed. Retry after reviewing the row.';
          await session.withTransaction(async () => {
            await db
              .collection<{ _id: string; seq: number }>('counters')
              .updateOne(
                { _id: 'organization-write' },
                { $inc: { seq: 1 } },
                { upsert: true, session },
              );
            const fresh = await authorize(req, 'governance.customer_import', 'update');
            if ('error' in fresh)
              throw new CustomerActivationError(
                fresh.error.status,
                'Import update is not permitted',
              );
            await col('customer_import_rows').updateOne(
              { _id: entry._id, committed_at: null },
              {
                $set: {
                  validation_status: 'error',
                  action: 'CONFLICT',
                  validation_errors: [{ field: '_row', message }],
                },
              },
              { session },
            );
          });
          results.push({
            rowId: entry._id,
            ok: false,
            customerId: null,
            membershipId: null,
            error: message,
          });
        }
      }
      const result = await session.withTransaction(async () => {
        await db
          .collection<{ _id: string; seq: number }>('counters')
          .updateOne(
            { _id: 'organization-write' },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
        const fresh = await authorize(req, 'governance.customer_import', 'update');
        if ('error' in fresh)
          throw new CustomerActivationError(fresh.error.status, 'Import update is not permitted');
        const current = await col('customer_import_rows')
          .find({ import_job_id: id }, { session })
          .toArray();
        const inserted = current.filter((r) => r.committed_at && r.action === 'CREATE').length,
          updated = current.filter((r) => r.committed_at && r.action === 'UPDATE').length,
          failed = current.filter(
            (r) => r.validation_status === 'error' || r.action === 'CONFLICT',
          ).length,
          pending = current.filter(
            (r) =>
              !r.committed_at &&
              r.validation_status !== 'error' &&
              ['CREATE', 'UPDATE'].includes(String(r.action)),
          ).length,
          skipped = current.length - inserted - updated - failed - pending;
        const patch = {
          status: pending ? 'committing' : failed ? 'completed_with_errors' : 'completed',
          inserted_rows: inserted,
          updated_rows: updated,
          skipped_rows: skipped,
          failed_rows: failed,
          invalid_rows: failed,
          valid_rows: current.length - failed,
          committed_at: pending ? null : new Date().toISOString(),
        };
        await col('customer_import_jobs').updateOne({ _id: id }, { $set: patch }, { session });
        await records.audit(
          actor.userId,
          pending ? 'CUSTOMER_IMPORT_PROGRESS' : 'CUSTOMER_IMPORT_COMMITTED',
          'customer_import_job',
          id,
          null,
          { inserted, updated, failed },
          session,
        );
        return customerImportCommitResponseSchema.parse({
          job: shapeImportJob({ ...job, ...patch, id }),
          committed: inserted + updated,
          failed,
          rowResults: results,
        });
      });
      return res.status(200).json(result);
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403 ? 'FORBIDDEN' : 'CONFLICT',
          error.message,
          error.status,
        );
      return fail(
        res,
        'INTERNAL',
        'Import confirmation is unavailable. Reload before retrying.',
        503,
      );
    } finally {
      await session.endSession();
    }
  };
}
const record = (value: unknown) => (value ?? {}) as Record<string, unknown>;
