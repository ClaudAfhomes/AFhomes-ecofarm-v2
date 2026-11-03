import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { z } from 'zod';
import { compareMoney } from '@afhomes/shared';
import { importClaimReconcileSchema, recordPurchasePaymentSchema } from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { CustomerActivationError, type MongoRow } from './customer-activation.mongo.js';
import { createMongoPurchaseRecords } from './purchase-records.mongo.js';
import { createMongoImportClaimRecords, importRevision } from './import-claim-records.mongo.js';
import { DOCUMENT_MAX_BYTES, mimeMatchesSignature } from './documents.js';
import type { PrivateObjectStore } from './private-object-store.js';
import { deny, fail, jsonBody, method, subPath } from './handler-kit.js';
import type { VercelRequest, VercelResponse } from './http.js';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const refuse = (status: number, message: string): never => {
  throw new CustomerActivationError(status, message);
};
const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});
const proofSchema = z.strictObject({
  mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  sizeBytes: z.number().int().positive().max(DOCUMENT_MAX_BYTES),
});

export function createMongoImportClaimsHandlers(
  db: Db,
  client: MongoClient,
  authorize: typeof authorizeAfHomes,
  env: NodeJS.ProcessEnv,
  objects?: PrivateObjectStore,
) {
  const col = (name: string) => db.collection<MongoRow>(name),
    records = createMongoImportClaimRecords(db),
    purchase = createMongoPurchaseRecords(db);
  async function authority(req: VercelRequest, action: 'view' | 'update') {
    const finance = await authorize(req, 'finance.payment_verification', action);
    if ('error' in finance) return finance;
    const customers = await authorize(req, 'sales.customers', 'view');
    if ('error' in customers) return customers;
    if (finance.userId !== customers.userId) refuse(403, 'Sign in again before reviewing imports');
    return finance;
  }
  async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Cache-Control', 'no-store');
    const path = subPath(req),
      verb = method(req),
      listing = /^(sources|reservations)\/([^/]+)\/claims$/.exec(path),
      mutation = /^payment-claims\/([^/]+)\/(reconcile|proof(?:\/(?:upload|complete))?)$/.exec(
        path,
      );
    if (!listing && !mutation)
      return fail(res, 'NOT_IMPLEMENTED', 'This native import workflow is not enabled', 501);
    if (
      !(listing && verb === 'GET') &&
      !(
        mutation &&
        ((verb === 'GET' && mutation[2] === 'proof') ||
          (verb === 'POST' &&
            ['reconcile', 'proof/upload', 'proof/complete'].includes(mutation[2]!)))
      )
    )
      return fail(res, 'NOT_FOUND', 'Import claim endpoint not found', 404);
    const id = z.uuid().safeParse(listing?.[2] ?? mutation?.[1]);
    if (!id.success) return fail(res, 'VALIDATION_ERROR', 'Invalid claim scope', 400);
    const session = client.startSession();
    try {
      const access = await authority(req, verb === 'GET' ? 'view' : 'update');
      if ('error' in access) return deny(res, access);
      if (listing) {
        const page = pageSchema.safeParse(req.query);
        if (!page.success) return fail(res, 'VALIDATION_ERROR', 'Invalid claim page', 400);
        const data = await session.withTransaction(async () => {
          const reservation =
            listing[1] === 'reservations'
              ? await col('reservation_agreements').findOne({ _id: id.data }, { session })
              : null;
          const sources =
            listing[1] === 'sources'
              ? await col('customer_import_purchase_sources')
                  .find({ _id: id.data }, { session })
                  .toArray()
              : reservation?.customer_application_id
                ? await col('customer_import_purchase_sources')
                    .find({ application_id: reservation.customer_application_id }, { session })
                    .toArray()
                : [];
          const claims = await col('customer_import_payment_claims')
            .find({ source_id: { $in: sources.map((s) => s._id) } }, { session })
            .sort({ _id: 1 })
            .skip(page.data.offset)
            .limit(page.data.limit)
            .toArray();
          const result = [],
            versions = new Map<string, string>();
          for (const claim of claims) {
            const source = sources.find((s) => s._id === claim.source_id)!;
            if (!versions.has(source._id))
              versions.set(source._id, await records.target(source, session));
            result.push(await records.view(claim, source, versions.get(source._id)!, session));
          }
          return result;
        });
        return res.status(200).json(data);
      }
      const result = await session.withTransaction(async () => {
        if (verb !== 'GET') {
          for (const lock of ['organization-write', 'sales-write'])
            await db
              .collection<{ _id: string; seq: number }>('counters')
              .updateOne({ _id: lock }, { $inc: { seq: 1 } }, { upsert: true, session });
        }
        const actor = await authority(req, verb === 'GET' ? 'view' : 'update');
        if ('error' in actor) refuse(actor.error.status, 'Import claim action is not permitted');
        if ('error' in actor) return;
        if (actor.userId !== access.userId) refuse(403, 'Sign in again before reviewing imports');
        const claim = await records.required('customer_import_payment_claims', id.data, session);
        if (mutation![2] === 'reconcile') {
          const parsed = importClaimReconcileSchema.safeParse(jsonBody(req));
          if (!parsed.success) refuse(400, 'Review the claim and provide a valid Finance decision');
          if (!parsed.success) return;
          const input = parsed.data,
            decision = input.decision,
            payload = { claimId: claim._id, ...input };
          const replay = await purchase.replay(
            actor.userId,
            'import.claim.reconcile',
            input.requestId,
            payload,
            session,
          );
          if (replay) return { paymentId: replay.result_id || null, status: replay.result_status };
          if (claim.payment_id) {
            if (
              (decision.kind === 'match' && decision.paymentId === claim.payment_id) ||
              (decision.kind === 'record' && decision.proofDocumentId === claim.proof_id)
            )
              return { paymentId: claim.payment_id, status: claim.status };
            refuse(409, 'The claim is already linked to a payment');
          }
          const source = await records.required(
            'customer_import_purchase_sources',
            String(claim.source_id),
            session,
          );
          if (
            importRevision(claim) !== input.expectedClaimVersion ||
            (await records.target(source, session)) !== input.expectedTargetVersion
          )
            refuse(409, 'The claim or purchase changed. Reload before continuing');
          let paymentId: string | null = null,
            status: string;
          if (decision.kind === 'hold' || decision.kind === 'reject')
            status = decision.kind === 'hold' ? 'held' : 'rejected';
          else {
            if (claim.status === 'rejected') refuse(409, 'The claim was rejected');
            const reservation = await col('reservation_agreements').findOne(
              {
                customer_application_id: source.application_id,
                status: 'executed',
                ...(decision.kind === 'record' ? { finalized_at: null } : {}),
              },
              { session, sort: { created_at: -1, _id: 1 } },
            );
            if (!reservation) refuse(409, 'An executed reservation is required');
            if (decision.kind === 'match') {
              const payment = await col('payments').findOne(
                { _id: decision.paymentId },
                { session },
              );
              if (
                !payment ||
                payment.customer_id !== source.customer_id ||
                payment.reservation_id !== reservation!._id ||
                ['voided', 'rejected'].includes(String(payment.status)) ||
                payment.method !== claim.method ||
                compareMoney(String(payment.amount), String(claim.amount)) !== 0
              )
                refuse(409, 'The existing payment does not match this claim and reservation');
              paymentId = decision.paymentId;
              status = 'matched';
            } else {
              if (
                decision.proofDocumentId !== claim.proof_id ||
                !claim.proof_uploaded_at ||
                !claim.proof_sha256
              )
                refuse(409, 'Upload and validate the receipt before recording a payment');
              if (
                (await records.candidates(claim, source, session)).length &&
                !decision.distinctPaymentReason
              )
                refuse(409, 'Review matching payments and explain why this payment is distinct');
              const paymentInput = recordPurchasePaymentSchema.safeParse({
                requestId: input.requestId,
                amount: claim.amount,
                paymentType: claim.purpose === 'reservation' ? 'down_payment' : claim.purpose,
                method: claim.method,
                reference: claim.bank_reference || undefined,
                notes: `Imported original payment date: ${claim.payment_date}. ${claim.notes ?? ''}`,
                receiptStoragePath: `afhomes-payment-receipts/${claim.proof_path}`,
              });
              if (!paymentInput.success) refuse(409, 'Imported payment fields require review');
              if (!paymentInput.success) return;
              const before = (await purchase.finance(reservation!._id, session)).verifiedTotal;
              const { requestId, ...payment } = paymentInput.data;
              paymentId = await purchase.record(
                reservation!._id,
                actor.userId,
                requestId,
                payment,
                session,
              );
              if ((await purchase.finance(reservation!._id, session)).verifiedTotal !== before)
                refuse(409, 'Recording must not change verified totals');
              status = 'recorded';
            }
          }
          await col('customer_import_payment_claims').updateOne(
            { _id: claim._id },
            {
              $set: {
                status,
                payment_id: paymentId,
                reviewed_by: actor.userId,
                review_reason:
                  'reason' in decision
                    ? decision.reason
                    : (decision.distinctPaymentReason ??
                      'Finance explicitly accepted reviewed receipt'),
                updated_at: new Date().toISOString(),
              },
            },
            { session },
          );
          await purchase.audit(
            actor.userId,
            'IMPORTED_PAYMENT_CLAIM_RECONCILED',
            'import_payment_claim',
            claim._id,
            null,
            { paymentId, decision: decision.kind },
            session,
          );
          await purchase.complete(
            actor.userId,
            'import.claim.reconcile',
            input.requestId,
            payload,
            paymentId ?? '',
            session,
          );
          await col('mutation_requests').updateOne(
            {
              actor_id: actor.userId,
              operation: 'import.claim.reconcile',
              request_id: input.requestId,
            },
            { $set: { result_status: status } },
            { session },
          );
          return { paymentId, status };
        }
        if (!objects) refuse(503, 'Private receipt storage is not configured');
        if (mutation![2] === 'proof/upload') {
          const input = proofSchema.safeParse(jsonBody(req));
          if (!input.success) refuse(400, 'Choose a JPEG, PNG or PDF receipt under 10 MiB');
          if (!input.success) return;
          if (claim.payment_id) refuse(409, 'The claim is already linked to a payment');
          const proofId = randomUUID(),
            token = randomBytes(32).toString('base64url'),
            expires = Date.now() + 300000;
          const key = `import-claims/${claim._id}/${proofId}${input.data.mime === 'application/pdf' ? '.pdf' : input.data.mime === 'image/jpeg' ? '.jpg' : '.png'}`;
          await col('customer_import_payment_claims').updateOne(
            { _id: claim._id },
            {
              $set: {
                proof_id: proofId,
                proof_path: key,
                proof_mime: input.data.mime,
                proof_size: input.data.sizeBytes,
                proof_sha256: null,
                proof_uploaded_at: null,
                proof_uploaded_by: actor.userId,
                updated_at: new Date().toISOString(),
                proof_upload_token_hash: hash(token),
                proof_upload_expires: expires,
                proof_upload_state: 'pending',
              },
            },
            { session },
          );
          const url = new URL(
            `/api/v1/customer-imports/payment-claims/${claim._id}/proof/bytes`,
            env.BETTER_AUTH_URL,
          );
          url.searchParams.set('token', token);
          return {
            proofDocumentId: proofId,
            uploadUrl: url.href,
            expiresAt: new Date(expires).toISOString(),
          };
        }
        if (!claim.proof_id || !claim.proof_path) refuse(409, 'A receipt is required');
        const key = `afhomes-payment-receipts/${claim.proof_path}`;
        if (mutation![2] === 'proof' && verb === 'GET') {
          if (!claim.proof_uploaded_at)
            refuse(409, 'Upload and validate the receipt before review');
          return objects!.downloadURL(key, 300);
        }
        const input = z.strictObject({ proofDocumentId: z.uuid() }).safeParse(jsonBody(req));
        if (
          !input.success ||
          input.data.proofDocumentId !== claim.proof_id ||
          claim.payment_id ||
          claim.proof_uploaded_by !== actor.userId ||
          claim.proof_upload_state !== 'uploaded'
        )
          refuse(409, 'The receipt upload changed. Start again');
        const file = await objects!.read(key, DOCUMENT_MAX_BYTES);
        if (
          !file ||
          file.bytes.length !== claim.proof_size ||
          !mimeMatchesSignature(String(claim.proof_mime), file.bytes)
        )
          refuse(400, 'Receipt bytes do not match the selected type and size');
        await col('customer_import_payment_claims').updateOne(
          { _id: claim._id },
          {
            $set: {
              proof_sha256: hash(file!.bytes),
              proof_uploaded_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          },
          { session },
        );
        return { ok: true };
      });
      return res.status(mutation![2] === 'proof/upload' ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof CustomerActivationError)
        return fail(
          res,
          error.status === 403
            ? 'FORBIDDEN'
            : error.status === 400
              ? 'VALIDATION_ERROR'
              : 'CONFLICT',
          error.message,
          error.status,
        );
      return fail(res, 'INTERNAL', 'Imported claim review is unavailable. Please retry.', 503);
    } finally {
      await session.endSession();
    }
  }
  async function upload(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost'),
      match = /^\/api\/v1\/customer-imports\/payment-claims\/([a-f0-9-]{36})\/proof\/bytes$/.exec(
        url.pathname,
      );
    if (!match) return false;
    const respond = (status: number) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(
        JSON.stringify(
          status === 200
            ? { uploaded: true }
            : {
                error: {
                  code: 'UPLOAD_FAILED',
                  message: 'Private receipt upload could not be completed',
                },
              },
        ),
      );
      return true;
    };
    let key: string | undefined,
      claim: MongoRow | null = null;
    const token = url.searchParams.get('token') ?? '',
      owner = randomUUID();
    try {
      if (req.method !== 'PUT' || !objects || !/^[a-zA-Z0-9_-]{43}$/.test(token))
        return respond(403);
      const grant = await col('customer_import_payment_claims').findOne({
        _id: match[1]!,
        proof_upload_token_hash: hash(token),
        proof_upload_expires: { $gt: Date.now() },
      });
      if (!grant) return respond(403);
      claim = await col('customer_import_payment_claims').findOneAndUpdate(
        {
          _id: grant._id,
          proof_id: grant.proof_id,
          payment_id: null,
          proof_upload_state: 'pending',
        },
        { $set: { proof_upload_state: 'uploading', proof_upload_owner: owner } },
        { returnDocument: 'after' },
      );
      if (!claim) return respond(409);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > Number(claim.proof_size) || size > DOCUMENT_MAX_BYTES)
          refuse(400, 'Receipt exceeds its size limit');
        chunks.push(bytes);
      }
      const bytes = Buffer.concat(chunks);
      if (size !== claim.proof_size || !mimeMatchesSignature(String(claim.proof_mime), bytes))
        refuse(400, 'Receipt bytes do not match');
      key = `afhomes-payment-receipts/${claim.proof_path}`;
      await objects.put(key, bytes, String(claim.proof_mime));
      const saved = await col('customer_import_payment_claims').updateOne(
        { _id: claim._id, proof_id: claim.proof_id, proof_upload_owner: owner },
        { $set: { proof_upload_state: 'uploaded' }, $unset: { proof_upload_owner: '' } },
      );
      if (saved.modifiedCount !== 1) refuse(409, 'Receipt upload changed');
      return respond(200);
    } catch (error) {
      if (key && objects)
        await objects.remove(key).catch(async () => {
          await col('storage_cleanup_jobs').updateOne(
            { object_key: key },
            {
              $setOnInsert: {
                _id: randomUUID(),
                object_key: key,
                created_at: new Date().toISOString(),
                status: 'pending',
              },
            },
            { upsert: true },
          );
        });
      if (claim)
        await col('customer_import_payment_claims').updateOne(
          { _id: claim._id, proof_upload_owner: owner },
          { $set: { proof_upload_state: 'pending' }, $unset: { proof_upload_owner: '' } },
        );
      return respond(error instanceof CustomerActivationError ? error.status : 503);
    }
  }
  return { handler, upload };
}
