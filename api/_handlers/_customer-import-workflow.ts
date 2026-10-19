import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  customerImportContinuationSchema,
  importSourceIntakeSchema,
  importPaymentClaimSchema,
  importClaimReconcileSchema,
  WORKBOOK_PAYMENT_SCHEMES,
} from '@afhomes/contracts';
import { authorizeAfHomes } from '../_lib/afhomes-access.js';
import {
  deny,
  fail,
  jsonBody,
  mapRpcError,
  method,
  subPath,
  type Db,
} from '../_lib/handler-kit.js';
import {
  storageClient,
  createUploadGrant,
  createDownloadGrant,
  downloadObject,
} from '../_lib/storage.js';
import { DOCUMENT_MAX_BYTES, mimeMatchesSignature } from '../_lib/documents.js';
import { loadImportRecoveryContext } from '../_lib/customer-import-continuation.js';
import { workbookApplicationPrefill } from '../_lib/customer-workbook.js';
import type { VercelRequest, VercelResponse } from '../_lib/http.js';

const listQuery = z.object({
  customerId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});
const uuid = z.uuid();

/** The import router delegates only its continuation/claim subroutes here. */
export async function handleImportWorkflow(
  req: VercelRequest,
  res: VercelResponse,
  db: Db,
): Promise<boolean> {
  const path = subPath(req),
    verb = method(req);
  if (path === 'continuations' && verb === 'GET') {
    const auth = await authorizeAfHomes(req, 'governance.customer_import', 'view');
    if ('error' in auth) {
      deny(res, auth);
      return true;
    }
    const customer = await authorizeAfHomes(req, 'sales.customers', 'view');
    if ('error' in customer) {
      deny(res, customer);
      return true;
    }
    const query = listQuery.safeParse(req.query);
    if (!query.success) {
      fail(res, 'VALIDATION_ERROR', 'Invalid continuation filters', 400);
      return true;
    }
    const result = await db.rpc('customer_import_continuations', {
      p_actor_id: auth.userId,
      p_customer_id: query.data.customerId ?? null,
      p_limit: query.data.limit,
      p_offset: query.data.offset,
    });
    if (result.error) mapRpcError(res, result.error);
    else res.status(200).json(z.array(customerImportContinuationSchema).parse(result.data));
    return true;
  }
  const intake = /^(rows|sources)\/([0-9a-f-]+)\/intake$/.exec(path);
  if (intake && verb === 'GET') {
    const auth = await authorizeAfHomes(req, 'governance.customer_import', 'view');
    if ('error' in auth) {
      deny(res, auth);
      return true;
    }
    const customer = await authorizeAfHomes(req, 'sales.customers', 'view');
    if ('error' in customer) {
      deny(res, customer);
      return true;
    }
    if (!uuid.safeParse(intake[2]).success) {
      fail(res, 'VALIDATION_ERROR', 'Invalid source', 400);
      return true;
    }
    let rowId = intake[2]!;
    if (intake[1] === 'sources') {
      const source = await db.rpc('customer_import_source_intake', {
        p_source_id: rowId,
        p_actor_id: auth.userId,
      });
      if (source.error) {
        mapRpcError(res, source.error);
        return true;
      }
      rowId = String(source.data.rowId);
    }
    const context = await loadImportRecoveryContext(db, rowId);
    const result = await db.rpc('preview_customer_import_continuation', {
      p_row_id: rowId,
      p_actor_id: auth.userId,
      ...context.recoveryArguments,
    });
    if (result.error) {
      mapRpcError(res, result.error);
      return true;
    }
    const fields: Record<string, string> = {
      ...context.fields,
      tin: '',
      secondary_tin: '',
      tin_number: '',
      supplementary_tin_number: '',
    };
    fields.stated_payment_scheme_code =
      WORKBOOK_PAYMENT_SCHEMES[fields.stated_payment_scheme ?? ''] ?? '';
    const team = Object.fromEntries(
      Object.entries({
        svdStaffId: 'vd_staff_id',
        ssmStaffId: 'ssm_staff_id',
        smStaffId: 'sm_staff_id',
        referrerStaffId: 'referrer_staff_id',
      }).flatMap(([key, field]) => (fields[field] ? [[key, fields[field]]] : [])),
    );
    res.status(200).json(
      importSourceIntakeSchema.parse({
        continuation: result.data,
        prefill: workbookApplicationPrefill(fields),
        claims: [],
        purchaseReference: fields.purchase_reference || null,
        team,
      }),
    );
    return true;
  }
  const claimList = /^(sources|reservations)\/([0-9a-f-]+)\/claims$/.exec(path);
  const claimRoute =
    /^payment-claims\/([0-9a-f-]+)\/(reconcile|proof(?:\/(?:upload|complete))?)$/.exec(path);
  if (!claimList && !claimRoute) return false;
  const auth = await authorizeAfHomes(
    req,
    'finance.payment_verification',
    verb === 'GET' ? 'view' : 'update',
  );
  if ('error' in auth) {
    deny(res, auth);
    return true;
  }
  const customer = await authorizeAfHomes(req, 'sales.customers', 'view');
  if ('error' in customer) {
    deny(res, customer);
    return true;
  }
  const id = uuid.safeParse(claimList?.[2] ?? claimRoute?.[1]);
  if (!id.success) {
    fail(res, 'VALIDATION_ERROR', 'Invalid payment source', 400);
    return true;
  }
  if (claimList && verb === 'GET') {
    const page = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(100),
        offset: z.coerce.number().int().nonnegative().default(0),
      })
      .safeParse(req.query);
    if (!page.success) {
      fail(res, 'VALIDATION_ERROR', 'Invalid claim page', 400);
      return true;
    }
    const result = await db.rpc('customer_import_payment_claims', {
      p_actor_id: auth.userId,
      p_source_id: claimList[1] === 'sources' ? id.data : null,
      p_reservation_id: claimList[1] === 'reservations' ? id.data : null,
      p_limit: page.data.limit,
      p_offset: page.data.offset,
    });
    if (result.error) mapRpcError(res, result.error);
    else res.status(200).json(z.array(importPaymentClaimSchema).parse(result.data));
    return true;
  }
  if (claimRoute?.[2] === 'reconcile' && verb === 'POST') {
    const input = importClaimReconcileSchema.safeParse(jsonBody(req));
    if (!input.success) {
      fail(res, 'VALIDATION_ERROR', 'Review the claim and provide a valid Finance decision', 400);
      return true;
    }
    const result = await db.rpc('accept_import_payment_claim_once', {
      p_claim_id: id.data,
      p_actor_id: auth.userId,
      p_request_id: input.data.requestId,
      p_expected_claim_version: input.data.expectedClaimVersion,
      p_expected_target_version: input.data.expectedTargetVersion,
      p_decision: input.data.decision,
    });
    if (result.error) mapRpcError(res, result.error);
    else res.status(200).json(result.data);
    return true;
  }
  if (!claimRoute || !['proof', 'proof/upload', 'proof/complete'].includes(claimRoute[2]!)) {
    fail(res, 'NOT_FOUND', 'Route not found', 404);
    return true;
  }
  const storage = storageClient();
  if (!storage) {
    fail(res, 'INTERNAL', 'Private receipt storage is not configured', 500);
    return true;
  }
  if (claimRoute[2] === 'proof/upload' && verb === 'POST') {
    const input = z
      .strictObject({
        mime: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
        sizeBytes: z.number().int().positive().max(DOCUMENT_MAX_BYTES),
      })
      .safeParse(jsonBody(req));
    if (!input.success) {
      fail(res, 'VALIDATION_ERROR', 'Choose a JPEG, PNG or PDF receipt under 10 MiB', 400);
      return true;
    }
    const prepared = await db.rpc('prepare_import_claim_proof', {
      p_claim_id: id.data,
      p_actor_id: auth.userId,
      p_mime: input.data.mime,
    });
    if (prepared.error) {
      mapRpcError(res, prepared.error);
      return true;
    }
    const grant = await createUploadGrant(
      storage,
      String(prepared.data.bucket),
      String(prepared.data.path),
    );
    res.status(201).json({ proofDocumentId: prepared.data.proofDocumentId, ...grant });
    return true;
  }
  const proof = await db.rpc('import_claim_proof', {
    p_claim_id: id.data,
    p_actor_id: auth.userId,
  });
  if (proof.error) {
    mapRpcError(res, proof.error);
    return true;
  }
  const data = proof.data as {
    proofDocumentId: string;
    bucket: string;
    path: string;
    mime: string;
    uploaded: boolean;
  };
  if (claimRoute[2] === 'proof' && verb === 'GET') {
    if (!data.uploaded) {
      fail(res, 'CONFLICT', 'Upload and validate the receipt before review', 409);
      return true;
    }
    res.status(200).json(await createDownloadGrant(storage, data.bucket, data.path));
    return true;
  }
  if (claimRoute[2] === 'proof/complete' && verb === 'POST') {
    const input = z.strictObject({ proofDocumentId: uuid }).safeParse(jsonBody(req));
    if (!input.success || input.data.proofDocumentId !== data.proofDocumentId) {
      fail(res, 'CONFLICT', 'The receipt upload changed; start again', 409);
      return true;
    }
    const file = await downloadObject(storage, data.bucket, data.path);
    if (
      'error' in file ||
      file.bytes.length > DOCUMENT_MAX_BYTES ||
      !mimeMatchesSignature(data.mime, file.bytes)
    ) {
      fail(
        res,
        'VALIDATION_ERROR',
        'Receipt bytes do not match the selected file type or size limit',
        400,
      );
      return true;
    }
    const completed = await db.rpc('complete_import_claim_proof', {
      p_claim_id: id.data,
      p_actor_id: auth.userId,
      p_proof_id: data.proofDocumentId,
      p_sha256: createHash('sha256').update(file.bytes).digest('hex'),
    });
    if (completed.error) mapRpcError(res, completed.error);
    else res.status(200).json({ ok: true });
    return true;
  }
  fail(res, 'NOT_FOUND', 'Route not found', 404);
  return true;
}
